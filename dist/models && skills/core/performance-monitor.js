/**
 * Performance Monitor - Real-time system performance monitoring.
 *
 * Implements PHASE 3 steps 35-49:
 * - Self-observation of internal processes
 * - Real-time performance monitoring
 * - Memory, CPU, energy, latency tracking
 * - Error rate monitoring
 * - Behavior change detection
 * - Prediction vs reality comparison
 */
export class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.componentMetrics = new Map();
        this.anomalies = [];
        this.predictions = [];
        this.maxPointsPerMetric = 1000;
        // Thresholds for anomaly detection
        this.thresholds = {
            cpuWarning: 80,
            cpuCritical: 95,
            memoryWarning: 80,
            memoryCritical: 95,
            latencyWarning: 1000, // ms
            latencyCritical: 5000, // ms
            errorRateWarning: 0.05,
            errorRateCritical: 0.2,
        };
    }
    /** Record a metric value */
    record(metricName, value, unit = '') {
        const now = Date.now();
        let series = this.metrics.get(metricName);
        if (!series) {
            series = { name: metricName, points: [], unit };
            this.metrics.set(metricName, series);
        }
        series.points.push({ timestamp: now, value });
        // Limit history size
        if (series.points.length > this.maxPointsPerMetric) {
            series.points = series.points.slice(-this.maxPointsPerMetric);
        }
    }
    /** Update component metrics */
    updateComponentMetrics(metrics) {
        this.componentMetrics.set(metrics.componentId, {
            ...metrics,
            lastUpdated: Date.now(),
        });
        // Check for anomalies
        this.checkAnomalies(metrics);
    }
    /** Get current metrics for a component */
    getComponentMetrics(componentId) {
        return this.componentMetrics.get(componentId);
    }
    /** Get all component metrics */
    getAllComponentMetrics() {
        return Array.from(this.componentMetrics.values());
    }
    /** Get metric history */
    getMetricHistory(metricName, durationMs) {
        const series = this.metrics.get(metricName);
        if (!series)
            return [];
        if (!durationMs)
            return [...series.points];
        const cutoff = Date.now() - durationMs;
        return series.points.filter(p => p.timestamp >= cutoff);
    }
    /** Get all tracked metric names */
    getMetricNames() {
        return Array.from(this.metrics.keys());
    }
    /** Calculate statistics for a metric */
    getMetricStats(metricName, durationMs) {
        const points = this.getMetricHistory(metricName, durationMs);
        if (points.length === 0)
            return null;
        const values = points.map(p => p.value).sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        const count = values.length;
        return {
            min: values[0],
            max: values[count - 1],
            avg: sum / count,
            p50: values[Math.floor(count * 0.5)],
            p95: values[Math.floor(count * 0.95)],
            p99: values[Math.floor(count * 0.99)],
            count,
        };
    }
    /** Check for anomalies in component metrics */
    checkAnomalies(metrics) {
        const now = Date.now();
        // CPU anomaly
        if (metrics.cpuPercent > this.thresholds.cpuCritical) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.cpu`,
                expectedValue: 50,
                actualValue: metrics.cpuPercent,
                deviation: metrics.cpuPercent - 50,
                severity: 'critical',
                timestamp: now,
                description: `Critical CPU usage: ${metrics.cpuPercent.toFixed(1)}%`,
            });
        }
        else if (metrics.cpuPercent > this.thresholds.cpuWarning) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.cpu`,
                expectedValue: 50,
                actualValue: metrics.cpuPercent,
                deviation: metrics.cpuPercent - 50,
                severity: 'high',
                timestamp: now,
                description: `High CPU usage: ${metrics.cpuPercent.toFixed(1)}%`,
            });
        }
        // Memory anomaly
        if (metrics.memoryMB > 2000) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.memory`,
                expectedValue: 500,
                actualValue: metrics.memoryMB,
                deviation: metrics.memoryMB - 500,
                severity: 'critical',
                timestamp: now,
                description: `Critical memory usage: ${metrics.memoryMB.toFixed(0)}MB`,
            });
        }
        // Latency anomaly
        if (metrics.latencyMs > this.thresholds.latencyCritical) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.latency`,
                expectedValue: 200,
                actualValue: metrics.latencyMs,
                deviation: metrics.latencyMs - 200,
                severity: 'critical',
                timestamp: now,
                description: `Critical latency: ${metrics.latencyMs.toFixed(0)}ms`,
            });
        }
        else if (metrics.latencyMs > this.thresholds.latencyWarning) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.latency`,
                expectedValue: 200,
                actualValue: metrics.latencyMs,
                deviation: metrics.latencyMs - 200,
                severity: 'high',
                timestamp: now,
                description: `High latency: ${metrics.latencyMs.toFixed(0)}ms`,
            });
        }
        // Error rate anomaly
        if (metrics.errorRate > this.thresholds.errorRateCritical) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.errors`,
                expectedValue: 0.01,
                actualValue: metrics.errorRate,
                deviation: metrics.errorRate - 0.01,
                severity: 'critical',
                timestamp: now,
                description: `Critical error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
            });
        }
        else if (metrics.errorRate > this.thresholds.errorRateWarning) {
            this.anomalies.push({
                metricName: `${metrics.componentId}.errors`,
                expectedValue: 0.01,
                actualValue: metrics.errorRate,
                deviation: metrics.errorRate - 0.01,
                severity: 'high',
                timestamp: now,
                description: `High error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
            });
        }
        // checkAnomalies() runs on every trackCall() across all six live entry
        // points (processQuery/solve/learn/collaborate/executePlan/
        // autonomousTask) -- real measured latency/CPU/memory/error-rate values
        // legitimately cross these thresholds under normal load, so this array
        // grows routinely. `points`/`predictions` above already cap themselves
        // with this same "slice to last N" idiom; `clearOldAnomalies()` existed
        // to do the equivalent for this array but had no call site anywhere.
        if (this.anomalies.length > 1000) {
            this.anomalies = this.anomalies.slice(-1000);
        }
    }
    /** Get recent anomalies */
    getAnomalies(limit = 50) {
        return this.anomalies.slice(-limit);
    }
    /** Clear old anomalies */
    clearOldAnomalies(maxAgeHours = 24) {
        const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
        this.anomalies = this.anomalies.filter(a => a.timestamp >= cutoff);
    }
    /** Record a prediction and its actual outcome */
    recordPrediction(predictionName, predicted, actual) {
        const error = Math.abs(predicted - actual);
        const accuracy = predicted !== 0
            ? 1 - (error / Math.abs(predicted))
            : actual === 0 ? 1 : 0;
        this.predictions.push({
            predictionName,
            predictedValue: predicted,
            actualValue: actual,
            error,
            accuracy: Math.max(0, accuracy),
            timestamp: Date.now(),
        });
        // Limit history
        if (this.predictions.length > 1000) {
            this.predictions = this.predictions.slice(-1000);
        }
    }
    /** Get prediction accuracy stats */
    getPredictionAccuracy(predictionName) {
        const filtered = predictionName
            ? this.predictions.filter(p => p.predictionName === predictionName)
            : this.predictions;
        if (filtered.length === 0)
            return null;
        const sumAccuracy = filtered.reduce((a, p) => a + p.accuracy, 0);
        const sumError = filtered.reduce((a, p) => a + p.error, 0);
        return {
            avgAccuracy: sumAccuracy / filtered.length,
            avgError: sumError / filtered.length,
            count: filtered.length,
        };
    }
    /** Get overall system health */
    getSystemHealth() {
        const components = this.getAllComponentMetrics();
        if (components.length === 0) {
            return {
                status: 'healthy',
                overallCpu: 0,
                overallMemory: 0,
                activeComponents: 0,
                totalErrors: 0,
                avgLatency: 0,
                timestamp: Date.now(),
            };
        }
        const avgCpu = components.reduce((a, c) => a + c.cpuPercent, 0) / components.length;
        const avgMemory = components.reduce((a, c) => a + c.memoryMB, 0) / components.length;
        const avgLatency = components.reduce((a, c) => a + c.latencyMs, 0) / components.length;
        const totalErrors = components.reduce((a, c) => a + c.errorRate, 0);
        let status = 'healthy';
        if (avgCpu > this.thresholds.cpuCritical || avgLatency > this.thresholds.latencyCritical) {
            status = 'critical';
        }
        else if (avgCpu > this.thresholds.cpuWarning || avgLatency > this.thresholds.latencyWarning) {
            status = 'degraded';
        }
        return {
            status,
            overallCpu: avgCpu,
            overallMemory: avgMemory,
            activeComponents: components.length,
            totalErrors,
            avgLatency,
            timestamp: Date.now(),
        };
    }
    /** Export metrics as JSON */
    export() {
        return JSON.stringify({
            metrics: Array.from(this.metrics.values()),
            components: this.getAllComponentMetrics(),
            anomalies: this.getAnomalies(),
            predictions: this.predictions,
            health: this.getSystemHealth(),
        }, null, 2);
    }
    /** Reset all metrics */
    reset() {
        this.metrics.clear();
        this.componentMetrics.clear();
        this.anomalies = [];
        this.predictions = [];
    }
}
