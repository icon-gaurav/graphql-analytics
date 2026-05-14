package writer

import (
	"context"
	"fmt"
	"log"
	"time"

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

var dbPool *pgxpool.Pool

// Start initializes the database connection pool
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

	// Test connection
	if err := dbPool.Ping(context.Background()); err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}

	log.Println("✓ Database connection established")

	return func() {
		if dbPool != nil {
			dbPool.Close()
		}
	}
}

// WriteAggregatedData writes aggregated data to TimescaleDB with retry logic
func WriteAggregatedData(ctx context.Context, data *AggregatedData) error {
	if dbPool == nil {
		return fmt.Errorf("database pool not initialized")
	}

	maxRetries := 3
	backoff := time.Millisecond * 100

	for attempt := 0; attempt < maxRetries; attempt++ {
		err := writeWithCOPY(ctx, data)
		if err == nil {
			return nil
		}

		if attempt < maxRetries-1 {
			time.Sleep(backoff)
			backoff *= 2
		} else {
			log.Printf("Failed to write data after %d retries: %v", maxRetries, err)
			return err
		}
	}

	return fmt.Errorf("max retries exceeded")
}

func writeWithCOPY(ctx context.Context, data *AggregatedData) error {
	conn, err := dbPool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire connection: %w", err)
	}
	defer conn.Release()

	// Insert into field_usage table
	query := `
		INSERT INTO field_usage (time, type_name, field_name, call_count, error_count)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (time, type_name, field_name) DO UPDATE
		SET call_count = field_usage.call_count + $4,
		    error_count = field_usage.error_count + $5
	`

	parts := splitFieldPath(data.FieldPath)
	typeName := parts[0]
	fieldName := parts[len(parts)-1]

	_, err = conn.Exec(ctx, query,
		data.Timestamp,
		typeName,
		fieldName,
		data.CallCount,
		data.ErrorCount,
	)

	if err != nil {
		return fmt.Errorf("failed to insert field usage: %w", err)
	}

	// Insert into resolver_timings table
	timingQuery := `
		INSERT INTO resolver_timings (time, field_path, p50_ms, p95_ms, p99_ms, call_count)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (time, field_path) DO UPDATE
		SET p50_ms = $3, p95_ms = $4, p99_ms = $5, call_count = $6
	`

	_, err = conn.Exec(ctx, timingQuery,
		data.Timestamp,
		data.FieldPath,
		data.P50Ms,
		data.P95Ms,
		data.P99Ms,
		data.CallCount,
	)

	if err != nil {
		return fmt.Errorf("failed to insert resolver timings: %w", err)
	}

	return nil
}

func splitFieldPath(path string) []string {
	var parts []string
	current := ""

	for _, ch := range path {
		if ch == '.' {
			if current != "" {
				parts = append(parts, current)
				current = ""
			}
		} else {
			current += string(ch)
		}
	}

	if current != "" {
		parts = append(parts, current)
	}

	return parts
}

