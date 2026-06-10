package intake

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
)

const defaultEventChannelSize = 10000

// OperationEvent matches the SDK schema.
type OperationEvent struct {
	OperationName   *string          `json:"operationName"`
	OperationType   string           `json:"operationType"`
	Fields          []FieldUsage     `json:"fields"`
	DurationMs      float64          `json:"durationMs"`
	ResolverTimings []ResolverTiming `json:"resolverTimings"`
	ClientName      *string          `json:"clientName"`
	Timestamp       int64            `json:"timestamp"`
	HasErrors       bool             `json:"hasErrors"`
	QueryDepth      int              `json:"queryDepth"`
	FieldCount      int              `json:"fieldCount"`
	ComplexityScore int              `json:"complexityScore"`
}

type FieldUsage struct {
	TypeName  string `json:"typeName"`
	FieldName string `json:"fieldName"`
}

type ResolverTiming struct {
	Path       string  `json:"path"`
	DurationMs float64 `json:"durationMs"`
}

var (
	eventsReceived atomic.Int64
	eventsDropped  atomic.Int64
	flushErrors    atomic.Int64
)

// NewEventChannel creates the shared intake channel consumed by the aggregator.
func NewEventChannel() chan OperationEvent {
	return make(chan OperationEvent, defaultEventChannelSize)
}

// MetricsHandler serves collector counters.
func MetricsHandler(w http.ResponseWriter, r *http.Request) {
	metrics := map[string]int64{
		"events_received": eventsReceived.Load(),
		"events_dropped":  eventsDropped.Load(),
		"flush_errors":    flushErrors.Load(),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(metrics)
}

// IncrementFlushErrors increments the flush error counter.
func IncrementFlushErrors() {
	flushErrors.Add(1)
}

func enqueueEvent(eventChan chan OperationEvent, event OperationEvent) {
	select {
	case eventChan <- event:
		eventsReceived.Add(1)
	default:
		// Channel full, drop event.
		eventsDropped.Add(1)
	}
}

