package intake

import (
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	collectortracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// StartOTLPHTTPListener starts an OTLP/HTTP traces endpoint and pushes converted events into eventChan.
// It accepts both application/x-protobuf and application/json content types.
func StartOTLPHTTPListener(port string, eventChan chan OperationEvent) (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/traces", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		defer func() {
			_ = r.Body.Close()
		}()

		body, err := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024))
		if err != nil {
			log.Printf("Failed reading OTLP body: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		request := &collectortracev1.ExportTraceServiceRequest{}
		contentType := r.Header.Get("Content-Type")
		if strings.Contains(contentType, "application/json") {
			if err := protojson.Unmarshal(body, request); err != nil {
				log.Printf("Failed decoding OTLP JSON traces payload: %v", err)
				eventsDropped.Add(1)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
		} else {
			// Default: application/x-protobuf
			if err := proto.Unmarshal(body, request); err != nil {
				log.Printf("Failed decoding OTLP protobuf traces payload: %v", err)
				eventsDropped.Add(1)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
		}

		events := convertOTLPTracesToEvents(request)
		for _, event := range events {
			enqueueEvent(eventChan, event)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	})

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("OTLP HTTP server error: %v", err)
		}
	}()

	return server, nil
}

type traceAggregate struct {
	operationName   *string
	operationType   string
	clientName      *string
	timestampMs     int64
	durationMs      float64
	hasErrors       bool
	queryDepth      int
	fieldCount      int
	complexityScore int
	fieldsByPath    map[string]FieldUsage
	resolverTimings []ResolverTiming
}

func convertOTLPTracesToEvents(request *collectortracev1.ExportTraceServiceRequest) []OperationEvent {
	if request == nil {
		return nil
	}

	traces := map[string]*traceAggregate{}
	for _, resourceSpans := range request.ResourceSpans {
		for _, scopeSpans := range resourceSpans.ScopeSpans {
			for _, span := range scopeSpans.Spans {
				if len(span.TraceId) == 0 {
					continue
				}
				traceKey := hex.EncodeToString(span.TraceId)
				aggregate, found := traces[traceKey]
				if !found {
					aggregate = &traceAggregate{
						operationType: "query",
						fieldsByPath:   make(map[string]FieldUsage),
					}
					traces[traceKey] = aggregate
				}

				attributes := attributesToMap(span.Attributes)
				isRoot := len(span.ParentSpanId) == 0 || isEmptyBytes(span.ParentSpanId)
				if isRoot {
					applyRootSpan(aggregate, span, attributes)
					continue
				}

				applyResolverSpan(aggregate, span, attributes)
			}
		}
	}

	events := make([]OperationEvent, 0, len(traces))
	for _, aggregate := range traces {
		if aggregate.timestampMs == 0 {
			continue
		}

		fields := make([]FieldUsage, 0, len(aggregate.fieldsByPath))
		for _, field := range aggregate.fieldsByPath {
			fields = append(fields, field)
		}
		sort.Slice(fields, func(i, j int) bool {
			if fields[i].TypeName == fields[j].TypeName {
				return fields[i].FieldName < fields[j].FieldName
			}
			return fields[i].TypeName < fields[j].TypeName
		})

		events = append(events, OperationEvent{
			OperationName:   aggregate.operationName,
			OperationType:   normalizeOperationType(aggregate.operationType),
			Fields:          fields,
			DurationMs:      aggregate.durationMs,
			ResolverTimings: aggregate.resolverTimings,
			ClientName:      aggregate.clientName,
			Timestamp:       aggregate.timestampMs,
			HasErrors:       aggregate.hasErrors,
			QueryDepth:      aggregate.queryDepth,
			FieldCount:      aggregate.fieldCount,
			ComplexityScore: aggregate.complexityScore,
		})
	}

	return events
}

func applyRootSpan(aggregate *traceAggregate, span *tracev1.Span, attributes map[string]*commonv1.AnyValue) {
	opName := readString(attributes, "graphql.operation.name")
	if opName != "" && opName != "anonymous" && opName != "unknown" {
		aggregate.operationName = pointer(opName)
	}

	opType := readString(attributes, "graphql.operation.type")
	if opType == "" {
		opType = inferOperationTypeFromSpanName(span.Name)
	}
	if opType != "" {
		aggregate.operationType = opType
	}

	clientName := readString(attributes, "graphql.client.name")
	if clientName != "" && clientName != "unknown" {
		aggregate.clientName = pointer(clientName)
	}

	aggregate.queryDepth = readInt(attributes, "graphql.query.depth")
	aggregate.fieldCount = readInt(attributes, "graphql.query.field_count")
	aggregate.complexityScore = readInt(attributes, "graphql.query.complexity_score")
	aggregate.timestampMs = int64(span.StartTimeUnixNano / uint64(time.Millisecond))
	aggregate.durationMs = nanosToMillis(span.EndTimeUnixNano - span.StartTimeUnixNano)

	if span.Status != nil && span.Status.Code == tracev1.Status_STATUS_CODE_ERROR {
		aggregate.hasErrors = true
	}
}

func applyResolverSpan(aggregate *traceAggregate, span *tracev1.Span, attributes map[string]*commonv1.AnyValue) {
	fieldPath := readString(attributes, "graphql.field.path")
	if fieldPath == "" {
		return
	}

	typeName := readString(attributes, "graphql.field.type")
	fieldName := readString(attributes, "graphql.field.name")
	if typeName == "" || fieldName == "" {
		typeName, fieldName = splitFieldPath(fieldPath)
	}

	aggregate.fieldsByPath[fieldPath] = FieldUsage{
		TypeName:  typeName,
		FieldName: fieldName,
	}
	aggregate.resolverTimings = append(aggregate.resolverTimings, ResolverTiming{
		Path:       fieldPath,
		DurationMs: nanosToMillis(span.EndTimeUnixNano - span.StartTimeUnixNano),
	})

	if span.Status != nil && span.Status.Code == tracev1.Status_STATUS_CODE_ERROR {
		aggregate.hasErrors = true
	}
}

func attributesToMap(attributes []*commonv1.KeyValue) map[string]*commonv1.AnyValue {
	result := make(map[string]*commonv1.AnyValue, len(attributes))
	for _, attribute := range attributes {
		if attribute == nil {
			continue
		}
		result[attribute.Key] = attribute.Value
	}
	return result
}

func readString(attributes map[string]*commonv1.AnyValue, key string) string {
	value := attributes[key]
	if value == nil {
		return ""
	}
	return strings.TrimSpace(value.GetStringValue())
}

func readInt(attributes map[string]*commonv1.AnyValue, key string) int {
	value := attributes[key]
	if value == nil {
		return 0
	}
	if intValue := value.GetIntValue(); intValue != 0 {
		return int(intValue)
	}
	if doubleValue := value.GetDoubleValue(); doubleValue != 0 {
		return int(doubleValue)
	}
	return 0
}

func normalizeOperationType(value string) string {
	switch strings.ToLower(value) {
	case "query", "mutation", "subscription":
		return strings.ToLower(value)
	default:
		return "query"
	}
}

func inferOperationTypeFromSpanName(spanName string) string {
	lower := strings.ToLower(spanName)
	switch {
	case strings.HasPrefix(lower, "graphql.mutation"):
		return "mutation"
	case strings.HasPrefix(lower, "graphql.subscription"):
		return "subscription"
	case strings.HasPrefix(lower, "graphql.query"):
		return "query"
	default:
		return ""
	}
}

func splitFieldPath(fieldPath string) (string, string) {
	parts := strings.Split(fieldPath, ".")
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	if len(cleaned) == 0 {
		return "Unknown", "Unknown"
	}
	if len(cleaned) == 1 {
		return cleaned[0], cleaned[0]
	}
	return cleaned[0], cleaned[len(cleaned)-1]
}

func nanosToMillis(nanos uint64) float64 {
	return float64(nanos) / float64(time.Millisecond)
}

func isEmptyBytes(value []byte) bool {
	for _, b := range value {
		if b != 0 {
			return false
		}
	}
	return true
}

func pointer[T any](value T) *T {
	return &value
}


