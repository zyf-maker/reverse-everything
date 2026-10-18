function compareRuntime(reference, replica) {
  const refKinds = reference?.summary?.kinds || count(reference?.events || []);
  const repKinds = replica?.summary?.kinds || count(replica?.events || []);
  const refStorage = Object.keys(reference?.page?.localStorage || {}).sort();
  const repStorage = Object.keys(replica?.page?.localStorage || {}).sort();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const errorFree = !(reference?.summary?.errors || replica?.summary?.errors);
  return {
    schema: 'own-reverse-runtime-comparison/v1',
    pass: same(refKinds, repKinds) && same(refStorage, repStorage) && errorFree,
    checks: {
      eventKinds: { pass: same(refKinds, repKinds), reference: refKinds, replica: repKinds },
      localStorageKeys: { pass: same(refStorage, repStorage), reference: refStorage, replica: repStorage },
      errorFree: { pass: errorFree, reference: reference?.summary?.errors || 0, replica: replica?.summary?.errors || 0 }
    }
  };
}

function compareReplay(reference, replica) {
  return {
    schema: 'own-reverse-replay-comparison/v1',
    pass: reference?.pass === true && replica?.pass === true,
    referencePass: reference?.pass === true,
    replicaPass: replica?.pass === true
  };
}

function count(events) { return events.reduce((out, event) => { out[event.kind] = (out[event.kind] || 0) + 1; return out; }, {}); }
module.exports = { compareRuntime, compareReplay };
