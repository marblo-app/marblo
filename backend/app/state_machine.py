from app.models import TaskStatus

# Valid state transitions: {current_status: {action: next_status}}
TRANSITIONS: dict[TaskStatus, dict[str, TaskStatus]] = {
    TaskStatus.TODO: {
        "claim": TaskStatus.CLAIMED,
    },
    TaskStatus.CLAIMED: {
        "start_work": TaskStatus.IN_PROGRESS,
    },
    TaskStatus.IN_PROGRESS: {
        "submit_review": TaskStatus.REVIEW,
        "blocked": TaskStatus.BLOCKED,
        "failed": TaskStatus.FAILED,
    },
    TaskStatus.REVIEW: {
        "approve": TaskStatus.DONE,
        "reject": TaskStatus.TODO,
    },
    TaskStatus.BLOCKED: {
        "resolve": TaskStatus.IN_PROGRESS,
    },
    TaskStatus.FAILED: {
        "retry": TaskStatus.TODO,
    },
    TaskStatus.DONE: {},
}


class InvalidTransitionError(Exception):
    def __init__(self, current: TaskStatus, action: str):
        self.current = current
        self.action = action
        valid = list(TRANSITIONS.get(current, {}).keys())
        super().__init__(
            f"Invalid transition: cannot '{action}' from {current.value}. "
            f"Valid actions: {valid}"
        )


def validate_transition(current: TaskStatus, action: str) -> TaskStatus:
    actions = TRANSITIONS.get(current, {})
    next_status = actions.get(action)
    if next_status is None:
        raise InvalidTransitionError(current, action)
    return next_status
