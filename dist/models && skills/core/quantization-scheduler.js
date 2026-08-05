// Background Quantization — scheduler.
//
// Runs quantization off the interactive path: after a build/train finishes,
// or when an extension is installed, weights get quantized in chunked,
// cooperatively-yielded ticks (same setImmediate-yield pattern trainer.ts
// uses for its own long loops) instead of as one blocking call on the
// caller's stack. Callers get a jobId back immediately and poll/subscribe
// for progress instead of awaiting the full pass.
import { BackgroundQuantizer, } from './onebrain.js';
import { detectHardwareProfile, resolveLayerBits, } from './quantization-hardware.js';
/** Cooperative yield: hands control back to the event loop between chunks of work. */
function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}
let jobCounter = 0;
export class BackgroundQuantizationScheduler {
    constructor(hardwareProfile = detectHardwareProfile()) {
        this.jobs = new Map();
        this.listeners = [];
        this.hardwareProfile = hardwareProfile;
    }
    onProgress(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
    emit(progress) {
        for (const listener of this.listeners)
            listener({ ...progress });
    }
    getJob(jobId) {
        return this.jobs.get(jobId)?.progress;
    }
    /** Resolves once the named job finishes (or throws if it failed). */
    async waitFor(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            throw new Error(`unknown quantization job: ${jobId}`);
        return job.promise;
    }
    /**
     * Enqueue a completed model's weights for background quantization.
     * Returns immediately with a jobId; the actual work happens across
     * cooperatively-yielded ticks so it never blocks whatever called this.
     */
    enqueue(model, options) {
        const jobId = `quant_${Date.now()}_${++jobCounter}`;
        const layerKeys = Object.keys(model).filter(k => !options.quantizerConfig.excludeLayers.includes(k));
        const progress = {
            jobId,
            status: 'queued',
            layersTotal: layerKeys.length,
            layersDone: 0,
        };
        const record = {
            progress,
            promise: this.runJob(jobId, model, layerKeys, options, progress),
        };
        this.jobs.set(jobId, record);
        return jobId;
    }
    async runJob(jobId, model, layerKeys, options, progress) {
        const layersPerTick = Math.max(1, options.layersPerTick ?? 4);
        const quantizer = new BackgroundQuantizer(options.quantizerConfig);
        const packed = {};
        const bitsByLayer = {};
        try {
            if (options.calibrationData) {
                progress.status = 'calibrating';
                this.emit(progress);
                for (const key of layerKeys) {
                    const samples = options.calibrationData[key];
                    if (samples)
                        quantizer.calibrate(key, samples);
                }
                await yieldToEventLoop();
            }
            progress.status = 'quantizing';
            this.emit(progress);
            for (let i = 0; i < layerKeys.length; i += layersPerTick) {
                const chunk = layerKeys.slice(i, i + layersPerTick);
                for (const key of chunk) {
                    const bits = options.mixedPrecisionPolicy
                        ? resolveLayerBits(key, model[key], options.mixedPrecisionPolicy)
                        : options.quantizerConfig.bits;
                    bitsByLayer[key] = bits;
                    packed[key] = quantizer.pack(model[key], key, bits);
                    progress.layersDone++;
                }
                this.emit(progress);
                await yieldToEventLoop();
            }
            progress.status = 'packing';
            this.emit(progress);
            await yieldToEventLoop();
            progress.status = 'done';
            this.emit(progress);
            const result = {
                jobId,
                packed,
                bitsByLayer,
                hardwareProfile: this.hardwareProfile,
            };
            const record = this.jobs.get(jobId);
            if (record)
                record.result = result;
            return result;
        }
        catch (err) {
            progress.status = 'failed';
            progress.error = err instanceof Error ? err.message : String(err);
            this.emit(progress);
            throw err;
        }
    }
    /**
     * Post-build hook: call once a training run or extension build produces
     * its final weights. Runs quantization in the background and returns the
     * jobId without making the caller wait — the wiki's "install projects
     * using quantization" step (see extension-builder) should call this
     * instead of quantizing synchronously on the request thread.
     */
    quantizeAfterBuild(model, options) {
        return this.enqueue(model, options);
    }
    /**
     * Extension-specific entry point: quantizes one extension's neuron
     * weights (keyed by neuron id) at install time. Semantically the same as
     * quantizeAfterBuild(), named separately so callers in the extension
     * builder read as intent, not as a generic model dump.
     */
    quantizeExtension(neuronWeights, quantizerConfig, mixedPrecisionPolicy) {
        return this.enqueue(neuronWeights, { quantizerConfig, mixedPrecisionPolicy });
    }
    getHardwareProfile() {
        return this.hardwareProfile;
    }
}
