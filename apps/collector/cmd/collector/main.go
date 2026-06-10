package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/graphql-analytics/collector/internal/aggregator"
	"github.com/graphql-analytics/collector/internal/intake"
)

func main() {
	// Load configuration from env
	otlpHTTPPort := os.Getenv("OTLP_HTTP_PORT")
	if otlpHTTPPort == "" {
		otlpHTTPPort = "4318" // OTLP HTTP — SDK sends directly here
	}

	dbWriteURL := os.Getenv("COLLECTOR_DB_URL")
	if dbWriteURL == "" {
		log.Fatal("COLLECTOR_DB_URL environment variable must be set")
	}

	eventChan := intake.NewEventChannel()

	otlpServer, err := intake.StartOTLPHTTPListener(otlpHTTPPort, eventChan)
	if err != nil {
		log.Fatalf("Failed to start OTLP HTTP listener: %v", err)
	}
	log.Printf("✓ OTLP HTTP listener started on port %s", otlpHTTPPort)

	// Start aggregator
	stopAggregator := aggregator.Start(eventChan, dbWriteURL)
	log.Printf("✓ Aggregator started")

	// Start metrics server
	go func() {
		log.Printf("✓ Metrics server starting on :9001")
		if err := http.ListenAndServe(":9001", http.HandlerFunc(intake.MetricsHandler)); err != nil {
			log.Printf("Metrics server error: %v", err)
		}
	}()

	// Graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigChan
	fmt.Printf("\nReceived signal: %v, shutting down...\n", sig)

	stopAggregator()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := otlpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("OTLP server shutdown error: %v", err)
	}

	fmt.Println("✓ Collector shut down gracefully")
}

