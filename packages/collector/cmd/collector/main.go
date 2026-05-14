package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/graphql-analytics/collector/internal/aggregator"
	"github.com/graphql-analytics/collector/internal/intake"
)

func main() {
	// Load configuration from env
	collectorPort := os.Getenv("COLLECTOR_PORT")
	if collectorPort == "" {
		collectorPort = "9000"
	}

	dbWriteURL := os.Getenv("DB_WRITE_URL")
	if dbWriteURL == "" {
		log.Fatal("DB_WRITE_URL environment variable must be set")
	}

	// Start UDP intake listener
	udpListener, eventChan, err := intake.StartUDPListener(collectorPort)
	if err != nil {
		log.Fatalf("Failed to start UDP listener: %v", err)
	}
	log.Printf("✓ UDP listener started on port %s", collectorPort)

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
	udpListener.Close()

	fmt.Println("✓ Collector shut down gracefully")
}

