# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

COPY go.mod ./
COPY go.sum ./
COPY . .

# Resolve and lock module checksums from actual imports before build.
RUN go mod tidy
RUN go mod download

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o collector ./cmd/collector

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/collector .

EXPOSE 9000/udp 9001

CMD ["./collector"]


