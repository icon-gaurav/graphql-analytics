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
	CallCount    int64
	ErrorCount   int64
	SumDurationMs  float64
	DurationSamples []float64
}

// Start starts the aggregator goroutine
func Start(eventChan chan intake.OperationEvent, dbWriteURL string) func() {
	buckets := make(map[BucketKey]*BucketData)
	var bucketLock sync.Mutex

	// Start database writer
	writerStop := writer.Start(dbWriteURL)

	// Ticker for periodic flush (60 seconds)
	ticker := time.NewTicker(60 * time.Second)
	stopChan := make(chan struct{})

	go func() {
		for {
			select {
			case event := <-eventChan:
				bucketLock.Lock()
				processEvent(&buckets, event)
				bucketLock.Unlock()

			case <-ticker.C:
				bucketLock.Lock()
				flushBuckets(&buckets)
				bucketLock.Unlock()

			case <-stopChan:
				bucketLock.Lock()
				flushBuckets(&buckets)
				bucketLock.Unlock()
				return
			}
		}
	}()

	return func() {
		ticker.Stop()
		close(stopChan)
		writerStop()
	}
}

func processEvent(buckets *map[BucketKey]*BucketData, event intake.OperationEvent) {
	minuteStamp := time.UnixMilli(event.Timestamp).Truncate(time.Minute).Unix()

	for _, field := range event.Fields {
		fieldPath := field.TypeName + "." + field.FieldName
		key := BucketKey{
			OperationName: "",
			FieldPath:     fieldPath,
			MinuteStamp:   minuteStamp,
		}

		if event.OperationName != nil {
			key.OperationName = *event.OperationName
		}

		if _, exists := (*buckets)[key]; !exists {
			(*buckets)[key] = &BucketData{
				DurationSamples: make([]float64, 0),
			}
		}

		bucket := (*buckets)[key]
		bucket.CallCount++
		bucket.SumDurationMs += event.DurationMs
		bucket.DurationSamples = append(bucket.DurationSamples, event.DurationMs)

		if event.HasErrors {
			bucket.ErrorCount++
		}
	}
}

func flushBuckets(buckets *map[BucketKey]*BucketData) {
	if len(*buckets) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Write batches to DB
	for key, data := range *buckets {
		p50, p95, p99 := calculatePercentiles(data.DurationSamples)

		err := writer.WriteAggregatedData(ctx, &writer.AggregatedData{
			OperationName: key.OperationName,
			FieldPath:     key.FieldPath,
			Timestamp:     time.Unix(key.MinuteStamp, 0),
			CallCount:     data.CallCount,
			ErrorCount:    data.ErrorCount,
			P50Ms:         p50,
			P95Ms:         p95,
			P99Ms:         p99,
		})

		if err != nil {
			log.Printf("Failed to write aggregated data: %v", err)
			intake.IncrementFlushErrors()
		}
	}

	// Clear buckets
	for k := range *buckets {
		delete(*buckets, k)
	}
}

func calculatePercentiles(samples []float64) (p50, p95, p99 float64) {
	if len(samples) == 0 {
		return 0, 0, 0
	}

	sorted := make([]float64, len(samples))
	copy(sorted, samples)
	sort.Float64s(sorted)

	n := len(sorted)
	p50 = sorted[n*50/100]
	p95 = sorted[max(n*95/100, n-1)]
	p99 = sorted[max(n*99/100, n-1)]

	return
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}



