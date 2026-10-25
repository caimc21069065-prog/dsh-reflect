/**
 * dsh-reflect — turn corrections into permanent rules (DeepSeek Harness).
 *
 * Two entry paths, one storage format (see the requirements doc):
 *
 * 1. Explicit trigger — a user message starting with `remember:` (or a
 *    configured Chinese prefix) is intercepted in `agent/pre-step`, confirmed
 *    through the user-questions confirm bar, written to the chosen
 *    AGENTS.md, and consumed without reaching the model. When confirmation
 *    is impossible (no UI, abort) or the content looks like a credential,
 *    the trigger is still consumed but a warning notice is injected so the
 *    "not saved" outcome is explicit instead of silent.
 * 2. Auto detection — short user prompts are filtered, classified by a
 *    one-shot call over the harness's own LLM route, and offered through the
 *    same confirm bar while the agent keeps answering. An offer dies when the
 *    user's next message enters a step or when a newer offer supersedes it.
 *
 * After a confirmed save the rule is queued into the live conversation as a
 * one-shot `dsh-reflect` notice (immediate effect), while future sessions
 * pick it up natively from AGENTS.md via `dsh-agent-instructions`.
 *
 * @module dsh-reflect
 */
import { join } from 'node:path';
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { Config } from "./config.js";
import { fastFilter, looksSensitive, parseClassification, buildClassifierRequest } from "./detect.js";
import { confirmRule, confirmRuleSafe } from "./confirm.js";
import { buildRuleNoticeMessage, buildWarningNotice } from "./notice.js";
import { extractRememberRule, messageText } from "./text.js";
import { ruleExists, saveRule } from "./storage.js";
export { Config } from "./config.js";
export { SECTION_START, SECTION_END, parseRuleSection, upsertRule } from "./rules.js";
export { fastFilter, parseClassification, looksSensitive } from "./detect.js";
export const name = 'dsh-reflect';
/** Service keys the plugin waits for; everything else is optional at use time. */
export const inject = ['workingDirectory'];
/** Absolute path of the global rule file for this configuration. */
function globalFilePath(config) {
    const configured = config.globalAgentsFile.trim();
    if (configured.length > 0)
        return expandHomePath(configured);
    return join(resolveDshHome(undefined, process.env), 'AGENTS.md');
}
/** Classifier route: explicit config override, else the agent's own route. */
function classifierRoute(agent, config) {
    const provider = config.classifierProvider.trim() || agent.options.provider;
    const model = config.classifierModel.trim() || agent.options.model;
    if (provider === undefined || model === undefined)
        return undefined;
    return { provider, model };
}
/** One classification attempt over the harness LLM runtime; failures stay silent. */
async function classify(ctx, route, text, signal) {
    const llm = ctx.get('llm');
    if (llm === undefined)
        return undefined;
    const request = buildClassifierRequest(text);
    try {
        const stream = llm.stream({
            provider: route.provider,
            model: route.model,
            system: request.system,
            messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
            maxTokens: 300,
            temperature: 0,
            signal,
        });
        let output = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text-delta')
                output += chunk.text;
        }
        return parseClassification(output);
    }
    catch (error) {
        ctx.logger.debug?.('dsh-reflect: classifier failed: %o', error);
        return undefined;
    }
}
/** Persist the rule and queue the immediate-effect notice. */
async function applySavedRule(ctx, agent, path, rule, scope) {
    // The confirm flow lets the user rewrite the rule text; re-check the final
    // content so an edited-in secret can never reach the file either.
    if (looksSensitive(rule)) {
        ctx.logger.error('dsh-reflect: 拒绝写入疑似敏感内容的规则 (%s)', path);
        agent.inject(buildWarningNotice('编辑后的规则疑似包含密钥或敏感信息，未写入文件。'));
        return;
    }
    try {
        const outcome = await saveRule(ctx, path, rule);
        if (outcome.status === 'corrupt') {
            ctx.logger.error('dsh-reflect: %s 的 dsh-reflect 标记段已损坏，拒绝自动写入；请手工检查该文件的 %s / %s 标记', path, '<!-- dsh-reflect: learned rules -->', '<!-- end dsh-reflect -->');
            agent.inject(buildWarningNotice(`目标文件 ${path} 的 dsh-reflect 标记段已损坏，本次未写入；请手工检查该文件的标记是否配对。`));
            return;
        }
        if (outcome.status === 'duplicate') {
            ctx.logger.info('dsh-reflect: rule already present in %s, skipping write', path);
            agent.inject(buildWarningNotice('该规则已存在，未重复写入。'));
            return;
        }
        agent.inject(buildRuleNoticeMessage(rule, scope, path));
        ctx.logger.info('dsh-reflect: rule saved to %s', path);
    }
    catch (error) {
        ctx.logger.error('dsh-reflect: 写入 %s 失败: %o', path, error);
        agent.inject(buildWarningNotice(`规则写入 ${path} 失败，本次未生效；可重试或手工添加。`));
    }
}
export function apply(ctx, config) {
    if (!config.enabled)
        return;
    const globalFile = globalFilePath(config);
    // Plugin lifetime signal: aborted when the plugin unloads.
    const lifecycle = new AbortController();
    ctx.effect(() => () => lifecycle.abort(new Error('dsh-reflect disposed')), 'dsh-reflect.lifecycle');
    // Per-agent cancellation so pending confirm/classify work dies with its agent.
    const lifetimes = new Map();
    // Auto-detect confirm offers: at most one live offer per agent, invalidated
    // by newer user input (see the pre-step hook) or a newer offer.
    const pendingOffers = new Map();
    ctx.on('agent/disposed', ({ agent }) => {
        lifetimes.get(agent)?.abort(new Error('agent disposed'));
        lifetimes.delete(agent);
        pendingOffers.get(agent)?.controller.abort(new Error('agent disposed'));
        pendingOffers.delete(agent);
        queuedCandidates.delete(agent);
    });
    const lifetimeOf = (agent) => {
        let controller = lifetimes.get(agent);
        if (controller === undefined) {
            controller = new AbortController();
            lifetimes.set(agent, controller);
        }
        return controller.signal;
    };
    const projectFileFor = async (agent, signal) => {
        const workingDirectory = ctx.get('workingDirectory');
        if (workingDirectory === undefined) {
            throw new Error('dsh-reflect: working-directory service is unavailable');
        }
        const cwd = await workingDirectory.ensure(agent, signal);
        return join(cwd, config.projectAgentsFile);
    };
    // ---- Path 1: explicit `remember:` triggers (F1) -------------------------
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        // A user message other than the offer's origin entering a step means the
        // conversation moved on: kill the stale auto-detect offer, if any.
        const pendingOffer = pendingOffers.get(agent);
        if (pendingOffer !== undefined
            && messages.some(message => message.source.kind === 'user' && message.id !== pendingOffer.originId)) {
            pendingOffer.controller.abort(new Error('dsh-reflect: offer superseded by newer input'));
            pendingOffers.delete(agent);
        }
        const triggered = [];
        for (const message of messages) {
            if (extractRememberRule(message, config.rememberPrefixes) !== undefined)
                triggered.push(message);
        }
        if (triggered.length === 0)
            return next();
        // Confirm each trigger in order; every decline just logs and moves on,
        // and every failure consumes the trigger with an explicit warning
        // instead of letting the message vanish silently.
        for (const message of triggered) {
            const rule = extractRememberRule(message, config.rememberPrefixes);
            if (rule === undefined)
                continue;
            if (looksSensitive(rule)) {
                agent.inject(buildWarningNotice('检测到疑似密钥或敏感信息，dsh-reflect 已拒绝保存该规则；请不要把密钥写入 AGENTS.md。'));
                ctx.logger.warn('dsh-reflect: remember trigger refused (sensitive content)');
                continue;
            }
            try {
                const outcome = await confirmRule(ctx, agent, signal, rule, config.locale);
                if (outcome.action === 'save') {
                    const path = outcome.scope === 'global' ? globalFile : await projectFileFor(agent, signal);
                    await applySavedRule(ctx, agent, path, outcome.rule, outcome.scope);
                }
                else {
                    ctx.logger.info('dsh-reflect: remember trigger skipped (%s)', outcome.reason ?? 'declined');
                }
            }
            catch (error) {
                ctx.logger.warn('dsh-reflect: remember confirm failed: %o', error);
                agent.inject(buildWarningNotice('确认界面不可用或已取消，该规则未被保存；可稍后重新发送 remember: 重试。'));
            }
        }
        // Cooperate with the rest of the chain first, then own the final call.
        const decision = await next();
        if (decision.kind === 'reject')
            return decision;
        // Only the CLAIMED batch decides whether real user input enters this
        // step. When every claimed message was a trigger, downstream-injected
        // context alone (e.g. the agent-instructions baseline) must not start a
        // model request — whatever the listener registration order happened to
        // be. A rejected fold self-heals: its owner recomposes on the next turn.
        if (!messages.some(message => !triggered.includes(message))) {
            return { kind: 'reject' };
        }
        const remaining = decision.messages.filter(message => !triggered.includes(message));
        if (remaining.length === 0)
            return { kind: 'reject' };
        return { ...decision, messages: remaining };
    });
    // ---- Path 2: automatic detection (F2) -----------------------------------
    if (!config.autoDetect)
        return;
    // Serializes the classifier call per agent. A candidate arriving while a
    // classification runs is queued (one slot, newest wins) and processed when
    // the current call settles, so a quick second correction is never silently
    // dropped. Confirmations are bounded by offer invalidation instead, so a
    // pending card never blocks detection.
    const classifying = new WeakSet();
    const queuedCandidates = new Map();
    const submitCandidate = (agent, message, text) => {
        if (classifying.has(agent)) {
            if (queuedCandidates.has(agent)) {
                ctx.logger.debug?.('dsh-reflect: replacing an older queued detection candidate');
            }
            queuedCandidates.set(agent, { message, text });
            return;
        }
        void detectAndOffer(agent, message, text)
            .catch((error) => ctx.logger.warn('dsh-reflect: detection failed: %o', error));
    };
    const detectAndOffer = async (agent, origin, text) => {
        const route = classifierRoute(agent, config);
        if (route === undefined)
            return;
        classifying.add(agent);
        let classification;
        try {
            classification = await classify(ctx, route, text, AbortSignal.any([lifecycle.signal, AbortSignal.timeout(config.detectTimeoutMs)]));
        }
        finally {
            classifying.delete(agent);
            const queued = queuedCandidates.get(agent);
            if (queued !== undefined) {
                queuedCandidates.delete(agent);
                submitCandidate(agent, queued.message, queued.text);
            }
        }
        if (classification === undefined)
            return;
        if (classification.confidence < config.confidenceThreshold)
            return;
        const rule = classification.rule;
        if (rule.length === 0 || looksSensitive(rule))
            return;
        // Do not re-offer rules that are already stored.
        try {
            if (await ruleExists(ctx, [globalFile, await projectFileFor(agent, lifecycle.signal)], rule)) {
                ctx.logger.debug?.('dsh-reflect: candidate already stored, skipping confirm');
                return;
            }
        }
        catch {
            // Unreadable targets must not block the confirm bar.
        }
        // Newest candidate wins: abort any older offer before registering ours.
        pendingOffers.get(agent)?.controller.abort(new Error('dsh-reflect: offer superseded'));
        const offerController = new AbortController();
        pendingOffers.set(agent, { controller: offerController, originId: origin.id });
        try {
            const outcome = await confirmRuleSafe(ctx, agent, AbortSignal.any([lifecycle.signal, lifetimeOf(agent), offerController.signal]), rule, config.locale, `原始消息：${text}`);
            if (outcome.action !== 'save')
                return;
            const path = outcome.scope === 'global' ? globalFile : await projectFileFor(agent, lifecycle.signal);
            await applySavedRule(ctx, agent, path, outcome.rule, outcome.scope);
        }
        finally {
            if (pendingOffers.get(agent)?.controller === offerController)
                pendingOffers.delete(agent);
        }
    };
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
        if (message.source.kind !== 'user')
            return;
        const filter = fastFilter(messageText(message), config.detectMaxChars, config.rememberPrefixes, config.detectPatternGate);
        if (!filter.pass)
            return;
        submitCandidate(agent, message, filter.text);
    });
}
