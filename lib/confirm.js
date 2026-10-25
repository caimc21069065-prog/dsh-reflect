/**
 * Confirm-bar flow over `ctx.userQuestions` (requirements F3/F4/F7).
 *
 * Nothing is ever written without an explicit human answer: one question
 * offers Save global / Save project / Edit / Skip; the Edit branch runs a
 * second round that lets the user rewrite the rule text and pick the scope.
 * UserQuestion failures (no UI attached, delegated caller, abort) degrade to
 * a silent skip — a missed rule is always preferable to a wrong one.
 *
 * @module dsh-reflect/confirm
 */
const COPY = {
    zh: {
        question: '把这条纠正保存为永久规则？',
        detail: '保存后写入 AGENTS.md，并在之后的会话自动生效。',
        saveGlobal: '保存到全局',
        saveGlobalDescription: '写入全局 AGENTS.md，对所有项目生效',
        saveProject: '保存到当前项目',
        saveProjectDescription: '写入当前项目的 AGENTS.md',
        edit: '编辑后保存…',
        editDescription: '先修改规则文本',
        skip: '跳过',
        skipDescription: '本次不保存',
        editQuestion: '编辑规则内容',
        editDetail: '可直接修改文本后提交；清空并提交表示取消。',
        keepOriginal: '保持原文',
        scopeQuestion: '保存到哪里？',
    },
    en: {
        question: 'Save this correction as a permanent rule?',
        detail: 'It will be written to AGENTS.md and applied in future sessions.',
        saveGlobal: 'Save globally',
        saveGlobalDescription: 'Written to the global AGENTS.md; applies to every project',
        saveProject: 'Save to this project',
        saveProjectDescription: 'Written to this project’s AGENTS.md',
        edit: 'Edit, then save…',
        editDescription: 'Rewrite the rule text first',
        skip: 'Skip',
        skipDescription: 'Do not save this time',
        editQuestion: 'Edit the rule text',
        editDetail: 'Submit the edited text; submit empty to cancel.',
        keepOriginal: 'Keep original',
        scopeQuestion: 'Where should it be saved?',
    },
};
function isUserQuestionError(error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = error.code;
        if (typeof code === 'string')
            return code;
    }
    return undefined;
}
/**
 * Run the confirm flow for one candidate rule.
 * @param originDetail optional human-facing context (e.g. the original prompt
 *   the classifier distilled the rule from).
 */
export async function confirmRule(ctx, agent, signal, rule, locale, originDetail) {
    const userQuestions = ctx.get('userQuestions');
    if (userQuestions === undefined) {
        return { action: 'skip', reason: 'user-questions service unavailable' };
    }
    const copy = COPY[locale];
    const answer = await userQuestions.ask({
        questions: [{
                id: 'dsh-reflect-save',
                question: copy.question,
                detail: originDetail === undefined ? copy.detail : `${copy.detail}\n\n${originDetail}`,
                options: [
                    { label: copy.saveGlobal, description: copy.saveGlobalDescription },
                    { label: copy.saveProject, description: copy.saveProjectDescription },
                    { label: copy.edit, description: copy.editDescription },
                    { label: copy.skip, description: copy.skipDescription },
                ],
            }],
        agent,
        signal,
    });
    const choice = answer.answers.find(item => item.id === 'dsh-reflect-save');
    if (choice === undefined)
        return { action: 'skip', reason: 'no answer' };
    const custom = choice.custom?.trim();
    if (custom !== undefined && custom.length > 0) {
        return finishEdit(ctx, agent, signal, copy, custom);
    }
    const selected = choice.selected[0];
    if (selected === copy.saveGlobal)
        return { action: 'save', rule, scope: 'global' };
    if (selected === copy.saveProject)
        return { action: 'save', rule, scope: 'project' };
    if (selected === copy.edit)
        return finishEdit(ctx, agent, signal, copy, rule);
    return { action: 'skip', reason: selected === undefined ? 'dismissed' : 'declined' };
}
async function finishEdit(ctx, agent, signal, copy, rule) {
    const userQuestions = ctx.get('userQuestions');
    if (userQuestions === undefined)
        return { action: 'skip', reason: 'user-questions service unavailable' };
    const answer = await userQuestions.ask({
        questions: [
            {
                id: 'dsh-reflect-rule',
                question: copy.editQuestion,
                detail: copy.editDetail,
                options: [{ label: copy.keepOriginal }],
            },
            {
                id: 'dsh-reflect-scope',
                question: copy.scopeQuestion,
                options: [
                    { label: copy.saveGlobal },
                    { label: copy.saveProject },
                ],
            },
        ],
        agent,
        signal,
    });
    const ruleAnswer = answer.answers.find(item => item.id === 'dsh-reflect-rule');
    if (ruleAnswer === undefined)
        return { action: 'skip', reason: 'no edited rule' };
    const edited = ruleAnswer.custom?.trim();
    const kept = ruleAnswer.selected.includes(copy.keepOriginal);
    const finalRule = edited !== undefined && edited.length > 0 ? edited : (kept ? rule : undefined);
    if (finalRule === undefined)
        return { action: 'skip', reason: 'edit cancelled' };
    const scopeAnswer = answer.answers.find(item => item.id === 'dsh-reflect-scope');
    const scope = scopeAnswer?.selected[0] === copy.saveProject ? 'project' : 'global';
    return { action: 'save', rule: finalRule, scope };
}
/**
 * Run `confirmRule` and map every failure mode to a silent skip, logging the
 * cause. Use this for the non-blocking auto-detection path.
 */
export async function confirmRuleSafe(ctx, agent, signal, rule, locale, originDetail) {
    try {
        return await confirmRule(ctx, agent, signal, rule, locale, originDetail);
    }
    catch (error) {
        const code = isUserQuestionError(error);
        if (code !== undefined) {
            ctx.logger.debug?.('dsh-reflect: confirm skipped (%s)', code);
            return { action: 'skip', reason: code };
        }
        ctx.logger.warn('dsh-reflect: confirm flow failed unexpectedly: %o', error);
        return { action: 'skip', reason: 'error' };
    }
}
