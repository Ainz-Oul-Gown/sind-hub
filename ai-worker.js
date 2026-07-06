// ai-worker.js

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;

let whisperModel = null;
const downloadTracker = {};

async function initWhisper() {
    if (whisperModel) return;
    
    whisperModel = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
        quantized: true,
        progress_callback: (data) => {
            if (data.status === 'progress') {
                downloadTracker[data.file] = { loaded: data.loaded, total: data.total };
                let totalLoaded = 0, totalExpected = 0;
                for (const key in downloadTracker) {
                    totalLoaded += downloadTracker[key].loaded || 0;
                    totalExpected += downloadTracker[key].total || 0;
                }
                if (totalExpected > 0) {
                    const percent = Math.round((totalLoaded / totalExpected) * 100);
                    // Отправляем проценты в главный поток
                    self.postMessage({ type: 'progress', percent: percent });
                }
            }
        }
    });
    
    // Сообщаем главному потоку, что модель готова
    self.postMessage({ type: 'ready' });
}

// Слушаем команды от главного потока
self.onmessage = async (event) => {
    const msg = event.data;
    
    if (msg.type === 'init') {
        initWhisper().catch(e => self.postMessage({ type: 'error', error: e.message }));
    } 
    else if (msg.type === 'transcribe') {
        try {
            if (!whisperModel) await initWhisper();
            // msg.audioData - это массив чисел (Float32Array), который переварит ИИ
            const output = await whisperModel(msg.audioData, { language: 'russian', task: 'transcribe' });
            
            // Возвращаем готовый текст
            self.postMessage({ type: 'result', text: output.text, id: msg.id });
        } catch (e) {
            self.postMessage({ type: 'error', error: e.message, id: msg.id });
        }
    }
};
