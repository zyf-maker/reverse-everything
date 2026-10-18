export class ReplicaError extends Error {
  constructor(message, code = 'REPLICA_ERROR', details = {}) {
    super(message);
    this.name = 'ReplicaError';
    this.code = code;
    this.details = details;
  }
}

export class AuthorizationError extends ReplicaError {
  constructor(message, details = {}) { super(message, 'AUTHORIZATION_REQUIRED', details); }
}

export class ScopeError extends ReplicaError {
  constructor(message, details = {}) { super(message, 'OUT_OF_SCOPE', details); }
}

export class CapabilityError extends ReplicaError {
  constructor(message, details = {}) { super(message, 'CAPABILITY_UNAVAILABLE', details); }
}

export class TransitionError extends ReplicaError {
  constructor(message, details = {}) { super(message, 'INVALID_TRANSITION', details); }
}
