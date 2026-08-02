"""
Circular Context System

Implements spec Part 5 sections 66-69: instead of a fixed context window
that simply forgets whatever falls off the end (Input -> Process ->
Forget), the AI uses continuous buffers where eviction is a handoff, not a
deletion (Input -> Buffer -> Process -> Continue -> Loop): "the oldest
information is compressed" and "important information moves into memory"
rather than vanishing.
"""

from typing import Any, Callable, Generic, List, Optional, TypeVar

T = TypeVar("T")


class CircularBuffer(Generic[T]):
    """
    A fixed-capacity FIFO buffer. Pushing past capacity evicts the oldest
    item and hands it to `on_evict` (typically "compress this into
    memory") before dropping it, so nothing disappears without a trace.
    """

    def __init__(self, capacity: int, on_evict: Optional[Callable[[T], None]] = None):
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self.capacity = capacity
        self.on_evict = on_evict
        self._items: List[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)
        if len(self._items) > self.capacity:
            oldest = self._items.pop(0)
            if self.on_evict is not None:
                self.on_evict(oldest)

    def load_items(self, items: List[T]) -> None:
        """Replace the buffer's contents directly (e.g. restoring from a
        backup), bypassing on_evict — nothing here counts as forgotten."""
        self._items = list(items[-self.capacity:])

    @property
    def items(self) -> List[T]:
        return list(self._items)

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self):
        return iter(self._items)

    def is_full(self) -> bool:
        return len(self._items) >= self.capacity


class CircularContextSystem:
    """
    Pairs an input buffer and an output buffer (sections 67-68) under one
    name, each with its own eviction handler, so a caller (UnifiedBrain)
    doesn't have to wire two CircularBuffers up separately.
    """

    def __init__(
        self,
        capacity: int,
        on_input_evict: Optional[Callable[[Any], None]] = None,
        on_output_evict: Optional[Callable[[Any], None]] = None,
    ):
        self.input_buffer: CircularBuffer = CircularBuffer(capacity, on_evict=on_input_evict)
        self.output_buffer: CircularBuffer = CircularBuffer(capacity, on_evict=on_output_evict)

    def record_input(self, item: Any) -> None:
        self.input_buffer.push(item)

    def record_output(self, item: Any) -> None:
        self.output_buffer.push(item)
