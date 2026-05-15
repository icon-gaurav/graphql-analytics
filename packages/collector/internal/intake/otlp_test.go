package intake

import (
	"testing"
	"time"

	collectortracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
)

func TestConvertOTLPTracesToEvents(t *testing.T) {
	traceID := []byte{0x01, 0x02, 0x03, 0x04}
	rootSpanID := []byte{0x10}
	fieldSpanID := []byte{0x11}
	start := uint64(time.Now().UnixNano())
	end := start + uint64(75*time.Millisecond)
	fieldEnd := start + uint64(12*time.Millisecond)

	request := &collectortracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				ScopeSpans: []*tracev1.ScopeSpans{
					{
						Spans: []*tracev1.Span{
							{
								TraceId:            traceID,
								SpanId:             rootSpanID,
								Name:               "graphql.query GetDashboard",
								StartTimeUnixNano:  start,
								EndTimeUnixNano:    end,
								Status:             &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
								Attributes: []*commonv1.KeyValue{
									stringAttr("graphql.operation.name", "GetDashboard"),
									stringAttr("graphql.operation.type", "query"),
									stringAttr("graphql.client.name", "web"),
									intAttr("graphql.query.depth", 3),
									intAttr("graphql.query.field_count", 12),
									intAttr("graphql.query.complexity_score", 18),
								},
							},
							{
								TraceId:            traceID,
								SpanId:             fieldSpanID,
								ParentSpanId:       rootSpanID,
								Name:               "graphql.field Query.viewer",
								StartTimeUnixNano:  start,
								EndTimeUnixNano:    fieldEnd,
								Status:             &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
								Attributes: []*commonv1.KeyValue{
									stringAttr("graphql.field.path", "Query.viewer"),
									stringAttr("graphql.field.type", "Query"),
									stringAttr("graphql.field.name", "viewer"),
								},
							},
						},
					},
				},
			},
		},
	}

	events := convertOTLPTracesToEvents(request)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	event := events[0]
	if event.OperationName == nil || *event.OperationName != "GetDashboard" {
		t.Fatalf("unexpected operation name: %+v", event.OperationName)
	}
	if event.OperationType != "query" {
		t.Fatalf("unexpected operation type: %s", event.OperationType)
	}
	if event.ClientName == nil || *event.ClientName != "web" {
		t.Fatalf("unexpected client name: %+v", event.ClientName)
	}
	if event.QueryDepth != 3 || event.FieldCount != 12 || event.ComplexityScore != 18 {
		t.Fatalf("unexpected query metrics: depth=%d fieldCount=%d complexity=%d", event.QueryDepth, event.FieldCount, event.ComplexityScore)
	}
	if len(event.Fields) != 1 {
		t.Fatalf("expected 1 field, got %d", len(event.Fields))
	}
	if event.Fields[0].TypeName != "Query" || event.Fields[0].FieldName != "viewer" {
		t.Fatalf("unexpected field usage: %+v", event.Fields[0])
	}
	if len(event.ResolverTimings) != 1 {
		t.Fatalf("expected 1 resolver timing, got %d", len(event.ResolverTimings))
	}
	if event.ResolverTimings[0].Path != "Query.viewer" {
		t.Fatalf("unexpected resolver path: %s", event.ResolverTimings[0].Path)
	}
	if event.DurationMs <= 0 {
		t.Fatalf("expected duration > 0, got %f", event.DurationMs)
	}
}

func TestConvertOTLPTracesToEventsSkipsTracesWithoutRootSpan(t *testing.T) {
	request := &collectortracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				ScopeSpans: []*tracev1.ScopeSpans{
					{
						Spans: []*tracev1.Span{
							{
								TraceId:      []byte{0x01},
								SpanId:       []byte{0x10},
								ParentSpanId: []byte{0x02},
								Attributes: []*commonv1.KeyValue{
									stringAttr("graphql.field.path", "Query.viewer"),
								},
							},
						},
					},
				},
			},
		},
	}

	events := convertOTLPTracesToEvents(request)
	if len(events) != 0 {
		t.Fatalf("expected 0 events, got %d", len(events))
	}
}

func stringAttr(key, value string) *commonv1.KeyValue {
	return &commonv1.KeyValue{
		Key: key,
		Value: &commonv1.AnyValue{
			Value: &commonv1.AnyValue_StringValue{StringValue: value},
		},
	}
}

func intAttr(key string, value int64) *commonv1.KeyValue {
	return &commonv1.KeyValue{
		Key: key,
		Value: &commonv1.AnyValue{
			Value: &commonv1.AnyValue_IntValue{IntValue: value},
		},
	}
}

