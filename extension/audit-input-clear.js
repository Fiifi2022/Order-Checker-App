// Only the unchanged inputs of a fully cleared audit may be erased.
export function createAuditInputClear({ getState, clearInputs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const passed = result => result?.allMatch === true && result.issueCount === 0 &&
    result.generalAudit?.decision !== 'review' && !result.generalAudit?.pendingOrderLimitCount;
  return {
    cancel,
    get pending() { return timer !== null; },
    schedule({hold = false} = {}) {
      cancel();
      const snapshot = getState();
      if (hold || snapshot.busy || !passed(snapshot.result) || !snapshot.inputs.some(text => text.trim())) return false;
      timer = setTimer(() => {
        timer = null;
        const current = getState();
        if (current.busy || current.result !== snapshot.result || current.context !== snapshot.context ||
            current.revision !== snapshot.revision || !passed(current.result) ||
            JSON.stringify(current.inputs) !== JSON.stringify(snapshot.inputs)) return;
        clearInputs();
      }, 5000);
      return true;
    },
  };
}
