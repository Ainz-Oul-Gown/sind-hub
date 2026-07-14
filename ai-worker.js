import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;

let whisperModel = null;
let currentModelName = 'Xenova/whisper-tiny'; // Модель по умолчанию
const downloadTracker = {};

async function initWhisper() {
    if (whisperModel) return;
    
    // Сообщаем UI, что начали грузить (чтобы сбить старые проценты)
    self.postMessage({ type: 'progress', percent: 0 }); 

    // Загружаем именно ту модель, которая лежит в переменной
    whisperModel = await pipeline('automatic-speech-recognition', currentModelName, {
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
                    self.postMessage({ type: 'progress', percent: percent });
                }
            }
        }
    });
    
    self.postMessage({ type: 'ready' });
}

// Слушаем команды от главного потока
self.onmessage = async (event) => {
    const msg = event.data;
    
    if (msg.type === 'init') {
        // Если при старте главный поток передал сохраненную модель — берем её
        if (msg.model) currentModelName = msg.model; 
        initWhisper().catch(e => self.postMessage({ type: 'error', error: e.message }));
    } 
    else if (msg.type === 'change_model') {
        // Если мы поменяли модель в настройках
        if (currentModelName !== msg.model) {
            currentModelName = msg.model;
            whisperModel = null; // СБРАСЫВАЕМ старую модель, чтобы освободить оперативу!
            
            // Очищаем трекер загрузки, иначе прогресс-бар новой модели сойдет с ума
            for (const prop of Object.getOwnPropertyNames(downloadTracker)) {
                delete downloadTracker[prop];
            }
            
            // Сразу запускаем скачивание/загрузку новой
            initWhisper().catch(e => self.postMessage({ type: 'error', error: e.message }));
        }
    }
    else if (msg.type === 'transcribe') {
        try {
            if (!whisperModel) await initWhisper();
            const output = await whisperModel(msg.audioData, { language: 'russian', task: 'transcribe' });
            self.postMessage({ type: 'result', text: output.text, id: msg.id });
        } catch (e) {
            self.postMessage({ type: 'error', error: e.message, id: msg.id });
        }
    }
};
