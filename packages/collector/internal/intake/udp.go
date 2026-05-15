package intake

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"sync/atomic"
)

// OperationEvent matches the SDK schema
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
	Path      string  `json:"path"`
	DurationMs float64 `json:"durationMs"`
}

var (
	eventsReceived  atomic.Int64
	eventsDropped   atomic.Int64
	flushErrors     atomic.Int64
)

// StartUDPListener starts listening on UDP port and returns the listener and event channel
func StartUDPListener(port string) (*net.UDPConn, chan OperationEvent, error) {
	addr, err := net.ResolveUDPAddr("udp4", ":"+port)
	if err != nil {
		return nil, nil, err
	}

	conn, err := net.ListenUDP("udp4", addr)
	if err != nil {
		return nil, nil, err
	}

	eventChan := make(chan OperationEvent, 10000)

	// Start listener goroutine
	go func() {
		buffer := make([]byte, 65507) // Max UDP packet size

		for {
			n, _, err := conn.ReadFromUDP(buffer)
			if err != nil {
				log.Printf("UDP read error: %v", err)
				continue
			}

			// Parse events
			var events []OperationEvent
			if err := json.Unmarshal(buffer[:n], &events); err != nil {
				log.Printf("Failed to parse events: %v", err)
				eventsDropped.Add(1)
				continue
			}

			for _, event := range events {
				enqueueEvent(eventChan, event)
			}
		}
	}()

	return conn, eventChan, nil
}

// MetricsHandler serves Prometheus metrics
func MetricsHandler(w http.ResponseWriter, r *http.Request) {
	metrics := map[string]int64{
		"events_received": eventsReceived.Load(),
		"events_dropped":  eventsDropped.Load(),
		"flush_errors":    flushErrors.Load(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// IncrementFlushErrors increments the flush error counter
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


