package aggregator

import (
	"context"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/graphql-analytics/collector/internal/intake"
	"github.com/graphql-analytics/collector/internal/writer"
)

type BucketKey struct {
	OperationName string
	FieldPath     string
	MinuteStamp   int64
}

type BucketData struct {
	CallCount       int64
	ErrorCount      int64
	SumDurationMs   float64
	DurationSamples []float64
}

type aggregateState struct {
	buckets    map[BucketKey]*BucketData
	operations []writer.OperationRecord
}

// Start starts the aggregator goroutine.
func Start(eventChan chan intake.OperationEvent, dbWriteURL string) func() {
	state := &aggregateState{
		buckets:    make(map[BucketKey]*BucketData),
		operations: make([]writer.OperationRecord, 0, 1024),
	}
	var stateLock sync.Mutex

	writerStop := writer.Start(dbWriteURL)

	ticker := time.NewTicker(60 * time.Second)
	stopChan := make(chan struct{})
	doneChan := make(chan struct{})

	go func() {
		defer close(doneChan)
		for {
			select {
			case event := <-eventChan:
				stateLock.Lock()
				processEvent(state, event)
				stateLock.Unlock()

			case <-ticker.C:
				stateLock.Lock()
				flushState(state)
				stateLock.Unlock()

			case <-stopChan:
				stateLock.Lock()
				flushState(state)
				stateLock.Unlock()
				return
			}
		}
	}()

	return func() {
		ticker.Stop()
		close(stopChan)
		<-doneChan
		writerStop()
	}
}

func processEvent(state *aggregateState, event intake.OperationEvent) {
	minuteStamp := time.UnixMilli(event.Timestamp).Truncate(time.Minute).Unix()
	operationName := ""
	if event.OperationName != nil {
		operationName = *event.OperationName
	}

	state.operations = append(state.operations, writer.OperationRecord{
		Timestamp:       time.UnixMilli(event.Timestamp),
		OperationName:   operationName,
		OperationType:   event.OperationType,
		DurationMs:      event.DurationMs,
		HasErrors:       event.HasErrors,
		ClientName:      event.ClientName,
		QueryDepth:      int32(event.QueryDepth),
		FieldCount:      int32(event.FieldCount),
		ComplexityScore: int32(event.ComplexityScore),
	})

	for _, field := range event.Fields {
		fieldPath := field.TypeName + "." + field.FieldName
		key := BucketKey{
			OperationName: operationName,
			FieldPath:     fieldPath,
			MinuteStamp:   minuteStamp,
		}

		if _, exists := state.buckets[key]; !exists {
			state.buckets[key] = &BucketData{
				DurationSamples: make([]float64, 0, 8),
			}
		}

		bucket := state.buckets[key]
		bucket.CallCount++
		bucket.SumDurationMs += event.DurationMs
		bucket.DurationSamples = append(bucket.DurationSamples, event.DurationMs)
		if event.HasErrors {
			bucket.ErrorCount++
		}
	}
}

func flushState(state *aggregateState) {
	if len(state.buckets) == 0 && len(state.operations) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	aggregated := make([]writer.AggregatedData, 0, len(state.buckets))
	for key, data := range state.buckets {
		p50, p95, p99 := calculatePercentiles(data.DurationSamples)
		aggregated = append(aggregated, writer.AggregatedData{
			OperationName: key.OperationName,
			FieldPath:     key.FieldPath,
			Timestamp:     time.Unix(key.MinuteStamp, 0),
			CallCount:     data.CallCount,
			ErrorCount:    data.ErrorCount,
			P50Ms:         p50,
			P95Ms:         p95,
			P99Ms:         p99,
		})
	}

	operations := append([]writer.OperationRecord(nil), state.operations...)
	if err := writer.WriteFlushBatch(ctx, aggregated, operations); err != nil {
		log.Printf("Failed to write flush batch: %v", err)
		intake.IncrementFlushErrors()
		return
	}

	clear(state.buckets)
	state.operations = state.operations[:0]
}

func calculatePercentiles(samples []float64) (p50, p95, p99 float64) {
	if len(samples) == 0 {
		return 0, 0, 0
	}

	sorted := make([]float64, len(samples))
	copy(sorted, samples)
	sort.Float64s(sorted)

	p50 = percentile(sorted, 0.50)
	p95 = percentile(sorted, 0.95)
	p99 = percentile(sorted, 0.99)

	return
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(float64(len(sorted)-1) * p)
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func clear(buckets map[BucketKey]*BucketData) {
	for k := range buckets {
		delete(buckets, k)
	}
}
