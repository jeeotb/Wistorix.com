// modules/downloader.js
import { fetchGoogleApiWithAuthRetry } from './drive.js';

export class SmartDownloader {
    constructor(token) {
        this.token = token;
        this.CHUNK_SIZE = 1024 * 1024 * 5; // 5MB mỗi phần (Tối ưu cho Drive)
        this.MAX_CONCURRENT = 4; // Tải cùng lúc 4 luồng (Tránh bị Google chặn)
        this.aborted = false;
    }

    async start(fileId, fileName, fileSize, onProgress) {
        this.aborted = false;
        fileSize = parseInt(fileSize);

        try {
            // 1. Xin quyền lưu file (User chọn chỗ lưu)
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: 'All Files',
                    accept: { '*/*': ['.' + fileName.split('.').pop()] },
                }],
            });

            // 2. Tạo luồng ghi file (WritableStream)
            const writable = await handle.createWritable();

            // 3. Tính toán số lượng chunks
            const totalChunks = Math.ceil(fileSize / this.CHUNK_SIZE);
            let downloadedBytes = 0;
            let activeConnections = 0;
            let currentChunkIndex = 0;

            // Hàm tải một chunk cụ thể
            const downloadChunk = async (index) => {
                if (this.aborted) return;

                const start = index * this.CHUNK_SIZE;
                const end = Math.min(start + this.CHUNK_SIZE - 1, fileSize - 1);
                
                // Retry logic (thử lại 3 lần nếu mạng lỗi)
                let retries = 3;
                while (retries > 0) {
                    try {
                        const response = await fetchGoogleApiWithAuthRetry(token => fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Range': `bytes=${start}-${end}` // KỸ THUẬT QUAN TRỌNG NHẤT
                            }
                        }));

                        if (!response.ok) {
                            const error = new Error(`HTTP ${response.status}`);
                            error.status = response.status;
                            throw error;
                        }

                        const blob = await response.blob();
                        const buffer = await blob.arrayBuffer();

                        // Ghi vào đúng vị trí (Seek & Write)
                        await writable.write({ type: 'write', position: start, data: buffer });

                        downloadedBytes += buffer.byteLength;
                        
                        // Callback cập nhật giao diện
                        const percent = Math.round((downloadedBytes / fileSize) * 100);
                        onProgress(percent, downloadedBytes, fileSize, activeConnections);
                        break; // Thành công thì thoát vòng lặp retry

                    } catch (e) {
                        // Adapter already used its one silent recovery for 401.
                        if (e.status === 401) throw e;
                        retries--;
                        console.warn(`Chunk ${index} failed, retrying... (${retries} left)`);
                        if (retries === 0) throw e;
                        await new Promise(r => setTimeout(r, 1000)); // Đợi 1s trước khi thử lại
                    }
                }
            };

            // 4. Quản lý hàng đợi tải (Pool Manager)
            const pool = [];
            for (let i = 0; i < totalChunks; i++) {
                // Nếu chưa đủ slot thì đẩy thêm task vào
                const p = downloadChunk(i).then(() => {
                    pool.splice(pool.indexOf(p), 1); // Xóa khỏi pool khi xong
                    activeConnections--;
                });
                
                pool.push(p);
                activeConnections++;

                // Nếu pool đầy, đợi 1 thằng xong mới nhét thằng tiếp theo vào
                if (pool.length >= this.MAX_CONCURRENT) {
                    await Promise.race(pool);
                }
            }

            // Đợi tất cả hoàn thành
            await Promise.all(pool);

            // 5. Đóng file
            await writable.close();
            return true;

        } catch (err) {
            console.error("Download Error:", err);
            if (err.name === 'AbortError') return false; // Người dùng hủy chọn file
            throw err;
        }
    }

    cancel() {
        this.aborted = true;
    }
}
