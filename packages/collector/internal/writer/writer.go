package writer

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AggregatedData struct {
	OperationName string
	FieldPath     string
	Timestamp     time.Time
	CallCount     int64
	ErrorCount    int64
	P50Ms         float64
	P95Ms         float64
	P99Ms         float64
}

type OperationRecord struct {
	Timestamp       time.Time
	OperationName   string
	OperationType   string
	DurationMs      float64
	HasErrors       bool
	ClientName      *string
	QueryDepth      int32
	FieldCount      int32
	ComplexityScore int32
}

type schemaSupport struct {
	operationQueryShape bool
	resolverOperation   bool
}

var dbPool *pgxpool.Pool
var support schemaSupport

// Start initializes the database connection pool.
func Start(dbWriteURL string) func() {
	config, err := pgxpool.ParseConfig(dbWriteURL)
	if err != nil {
		log.Fatalf("Failed to parse DB URL: %v", err)
	}

	config.MaxConns = 5
	config.MinConns = 1

	var errInit error
	dbPool, errInit = pgxpool.NewWithConfig(context.Background(), config)
	if errInit != nil {
		log.Fatalf("Failed to create DB pool: %v", errInit)
	}

	if err := dbPool.Ping(context.Background()); err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}

	if err := loadSchemaSupport(context.Background()); err != nil {
		log.Printf("Warning: failed to inspect DB schema support: %v", err)
	}

	log.Println("✓ Database connection established")

	return func() {
		if dbPool != nil {
			dbPool.Close()
		}
	}
}

// WriteFlushBatch writes a full collector flush to TimescaleDB with retry logic.
func WriteFlushBatch(ctx context.Context, aggregated []AggregatedData, operations []OperationRecord) error {
	if dbPool == nil {
		return fmt.Errorf("database pool not initialized")
	}

	if len(aggregated) == 0 && len(operations) == 0 {
		return nil
	}

	maxRetries := 3
	backoff := 100 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		err := writeBatch(ctx, aggregated, operations)
		if err == nil {
			return nil
		}

		if attempt == maxRetries-1 {
			log.Printf("Failed to write batch after %d retries: %v", maxRetries, err)
			return err
		}

		time.Sleep(backoff)
		backoff *= 2
	}

	return fmt.Errorf("max retries exceeded")
}

func writeBatch(ctx context.Context, aggregated []AggregatedData, operations []OperationRecord) error {
	conn, err := dbPool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire connection: %w", err)
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	batch := &pgx.Batch{}

	for _, operation := range operations {
		if support.operationQueryShape {
			batch.Queue(`
				INSERT INTO operations (
					time,
					operation_name,
					operation_type,
					duration_ms,
					has_errors,
					client_name,
					query_depth,
					field_count,
					complexity_score
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			`,
				operation.Timestamp,
				normalizeOperationName(operation.OperationName),
				operation.OperationType,
				operation.DurationMs,
				operation.HasErrors,
				operation.ClientName,
				operation.QueryDepth,
				operation.FieldCount,
				operation.ComplexityScore,
			)
		} else {
			batch.Queue(`
				INSERT INTO operations (
					time,
					operation_name,
					operation_type,
					duration_ms,
					has_errors,
					client_name
				)
				VALUES ($1, $2, $3, $4, $5, $6)
			`,
				operation.Timestamp,
				normalizeOperationName(operation.OperationName),
				operation.OperationType,
				operation.DurationMs,
				operation.HasErrors,
				operation.ClientName,
			)
		}
	}

	for _, data := range aggregated {
		parts := splitFieldPath(data.FieldPath)
		typeName := parts[0]
		fieldName := parts[len(parts)-1]

		batch.Queue(`
			INSERT INTO field_usage (time, type_name, field_name, call_count, error_count)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (time, type_name, field_name) DO UPDATE
			SET call_count = field_usage.call_count + EXCLUDED.call_count,
			    error_count = field_usage.error_count + EXCLUDED.error_count
		`,
			data.Timestamp,
			typeName,
			fieldName,
			data.CallCount,
			data.ErrorCount,
		)

		if support.resolverOperation {
			batch.Queue(`
				INSERT INTO resolver_timings (time, operation_name, field_path, p50_ms, p95_ms, p99_ms, call_count)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT (time, operation_name, field_path) DO UPDATE
				SET p50_ms = EXCLUDED.p50_ms,
				    p95_ms = EXCLUDED.p95_ms,
				    p99_ms = EXCLUDED.p99_ms,
				    call_count = resolver_timings.call_count + EXCLUDED.call_count
			`,
				data.Timestamp,
				normalizeOperationName(data.OperationName),
				data.FieldPath,
				data.P50Ms,
				data.P95Ms,
				data.P99Ms,
				data.CallCount,
			)
		} else {
			batch.Queue(`
				INSERT INTO resolver_timings (time, field_path, p50_ms, p95_ms, p99_ms, call_count)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (time, field_path) DO UPDATE
				SET p50_ms = EXCLUDED.p50_ms,
				    p95_ms = EXCLUDED.p95_ms,
				    p99_ms = EXCLUDED.p99_ms,
				    call_count = resolver_timings.call_count + EXCLUDED.call_count
			`,
				data.Timestamp,
				data.FieldPath,
				data.P50Ms,
				data.P95Ms,
				data.P99Ms,
				data.CallCount,
			)
		}
	}

	results := tx.SendBatch(ctx, batch)
	if err := results.Close(); err != nil {
		return fmt.Errorf("failed to execute batch: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit batch: %w", err)
	}

	return nil
}

func splitFieldPath(path string) []string {
	parts := strings.Split(path, ".")
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	if len(cleaned) == 0 {
		return []string{"Unknown"}
	}
	return cleaned
}

func normalizeOperationName(value string) string {
	if value == "" {
		return "anonymous"
	}
	return value
}

func loadSchemaSupport(ctx context.Context) error {
	rows, err := dbPool.Query(ctx, `
		SELECT table_name, column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name IN ('operations', 'resolver_timings')
	`)
	if err != nil {
		return fmt.Errorf("failed to inspect schema support: %w", err)
	}
	defer rows.Close()

	operationColumns := map[string]bool{}
	resolverColumns := map[string]bool{}
	for rows.Next() {
		var tableName string
		var columnName string
		if err := rows.Scan(&tableName, &columnName); err != nil {
			return fmt.Errorf("failed to scan schema support row: %w", err)
		}
		if tableName == "operations" {
			operationColumns[columnName] = true
		}
		if tableName == "resolver_timings" {
			resolverColumns[columnName] = true
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate schema support rows: %w", err)
	}

	support.operationQueryShape = operationColumns["query_depth"] && operationColumns["field_count"] && operationColumns["complexity_score"]
	support.resolverOperation = resolverColumns["operation_name"]
	return nil
}

