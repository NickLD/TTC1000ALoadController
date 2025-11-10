// COBS encoding/decoding functions
class COBS {
    // Encode data using COBS algorithm
    static encode(data) {
        if (!data || data.length === 0) {
            return new Uint8Array([0x01]); // Single overhead byte for empty data
        }

        const maxEncodedLength = data.length + Math.ceil(data.length / 254);
        const encoded = new Uint8Array(maxEncodedLength);
        let encodeIndex = 0;
        let codeIndex = encodeIndex++;
        let code = 1;

        for (let i = 0; i < data.length; i++) {
            if (data[i] !== 0) { // Non-zero byte, copy it
                encoded[encodeIndex++] = data[i];
                code++;
            }

            if (data[i] === 0 || code === 0xFF) { // Zero byte or block completed, restart
                encoded[codeIndex] = code;
                code = 1;
                codeIndex = encodeIndex;
                if (data[i] === 0 || i < data.length - 1) {
                    encodeIndex++;
                }
            }
        }

        encoded[codeIndex] = code; // Write final code value
        
        // Return trimmed array
        return encoded.slice(0, encodeIndex);
    }

    // Decode COBS encoded data
    static decode(encodedData) {
        if (!encodedData || encodedData.length === 0) {
            return new Uint8Array(0);
        }

        const decoded = new Uint8Array(encodedData.length); // Worst case: same size
        let decodeIndex = 0;
        let encodeIndex = 0;
        let code = 0xFF;
        let block = 0;

        while (encodeIndex < encodedData.length) {
            if (block !== 0) { // Decode block byte
                decoded[decodeIndex++] = encodedData[encodeIndex++];
                block--;
            } else {
                block = encodedData[encodeIndex++]; // Fetch next block length
                if (block !== 0 && code !== 0xFF) { // Encoded zero, write it unless it's delimiter
                    decoded[decodeIndex++] = 0;
                }
                
                code = block;
                if (code === 0) { // Delimiter code found
                    break;
                }
                
                block--; // Decrement since we'll process the code byte
            }
        }

        // Return trimmed array
        return decoded.slice(0, decodeIndex);
    }

    // Create a complete COBS packet with delimiter
    static createPacket(data) {
        const encoded = this.encode(data);
        const packet = new Uint8Array(encoded.length + 1);
        packet.set(encoded);
        packet[encoded.length] = 0x00; // Add delimiter
        return packet;
    }
}

// WebSerial wrapper with COBS framing
class BinarySerialHandler {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.dotNetReference = null;
        this.isReading = false;
        this.incomingBuffer = new Uint8Array(0);
    }

    init(dotNetRef) {
        this.dotNetReference = dotNetRef;
        console.log('Binary Serial Handler initialized');
    }

    isSupported() {
        return 'serial' in navigator;
    }

    async connect(baudRate = 115200) {
        try {
            if (!this.isSupported()) {
                throw new Error('Web Serial API not supported in this browser');
            }

            this.port = await navigator.serial.requestPort();
            await this.port.open({
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                flowControl: "none"
            });

            // Set DTR (Data Terminal Ready) signal to notify device of connection
            // This allows the firmware to detect when the web app connects
            if (typeof this.port.setSignals === 'function') {
                try {
                    await this.port.setSignals({ dataTerminalReady: true });
                    console.log('DTR signal set successfully');
                } catch (signalError) {
                    console.warn('Failed to set DTR signal (device may not support it):', signalError.message);
                }
            } else {
                console.warn('SerialPort.setSignals() not available in this browser - device may not detect connection automatically');
            }

            this.reader = this.port.readable.getReader();
            this.writer = this.port.writable.getWriter();

            if (this.dotNetReference) {
                await this.dotNetReference.invokeMethodAsync('OnConnectionStatusChanged', true);
            }

            this.startReading();
            return true;
        } catch (error) {
            console.error('Failed to connect:', error);
            if (this.dotNetReference) {
                await this.dotNetReference.invokeMethodAsync('OnConnectionStatusChanged', false);
            }
            return false;
        }
    }

    async disconnect() {
        try {
            console.log('Disconnecting from serial port...');
            this.isReading = false;

            if (this.reader) {
                try {
                    await this.reader.cancel();
                    this.reader.releaseLock();
                } catch (e) {
                    console.log('Reader cleanup error (device may be lost):', e.message);
                }
                this.reader = null;
            }

            if (this.writer) {
                try {
                    this.writer.releaseLock();
                } catch (e) {
                    console.log('Writer cleanup error (device may be lost):', e.message);
                }
                this.writer = null;
            }

            if (this.port) {
                try {
                    await this.port.close();
                } catch (e) {
                    console.log('Port close error (device may be lost):', e.message);
                }
                this.port = null;
            }

            if (this.dotNetReference) {
                await this.dotNetReference.invokeMethodAsync('OnConnectionStatusChanged', false);
            }
            
            console.log('Serial port disconnected successfully');
        } catch (error) {
            console.error('Error during disconnect:', error);
        }
    }

    // Send data with COBS framing
    async sendRaw(data) {
        if (!this.writer) {
            throw new Error('Not connected to serial port');
        }

        // Create COBS packet with delimiter
        const packet = COBS.createPacket(data);
        await this.writer.write(packet);
    }

    // Append new data to buffer
    appendToBuffer(newData) {
        const combined = new Uint8Array(this.incomingBuffer.length + newData.length);
        combined.set(this.incomingBuffer);
        combined.set(newData, this.incomingBuffer.length);
        this.incomingBuffer = combined;
    }

    // Extract complete COBS packets from buffer
    extractPackets() {
        const packets = [];
        
        while (true) {
            // Look for packet delimiter (0x00)
            const delimiterIndex = this.incomingBuffer.indexOf(0x00);
            
            if (delimiterIndex === -1) {
                break; // No complete packet yet
            }
            
            if (delimiterIndex === 0) {
                // Empty packet or stray delimiter at start, remove and continue
                this.incomingBuffer = this.incomingBuffer.slice(1);
                continue;
            }
            
            try {
                // Extract COBS encoded data (without delimiter)
                const encodedData = this.incomingBuffer.slice(0, delimiterIndex);
                
                // Remove processed packet from buffer (including delimiter)
                this.incomingBuffer = this.incomingBuffer.slice(delimiterIndex + 1);
                
                // Decode COBS packet
                const decodedData = COBS.decode(encodedData);
                packets.push(decodedData);
            } catch (error) {
                console.error('Failed to decode COBS packet:', error);
                // Remove the invalid packet and continue
                this.incomingBuffer = this.incomingBuffer.slice(delimiterIndex + 1);
            }
        }
        
        return packets;
    }

    async startReading() {
        this.isReading = true;

        try {
            while (this.isReading && this.reader) {
                const { value, done } = await this.reader.read();
                
                if (done) {
                    console.log('Serial reading ended (done=true)');
                    break;
                }

                if (value && value.length > 0) {
                    // Add to buffer and extract complete packets
                    this.appendToBuffer(value);
                    const packets = this.extractPackets();
                    
                    // Send decoded packets to .NET
                    for (const packet of packets) {
                        if (this.dotNetReference) {
                            await this.dotNetReference.invokeMethodAsync('OnPacketReceived', packet);
                        }
                    }
                }
            }
        } catch (error) {
            if (this.isReading) {
                console.error('Error reading from serial port:', error);
                
                // Check if this is a device lost error
                if (error.name === 'NetworkError' || 
                    error.message.includes('device has been lost') ||
                    error.message.includes('lost connection')) {
                    console.log('Device lost - cleaning up connection');
                    
                    // Device was disconnected, clean up
                    await this.handleDeviceLost();
                }
            }
        } finally {
            console.log('Serial reading loop ended');
        }
    }

    async handleDeviceLost() {
        try {
            // Mark as not reading to prevent further attempts
            this.isReading = false;
            
            // Notify .NET about disconnection
            if (this.dotNetReference) {
                await this.dotNetReference.invokeMethodAsync('OnConnectionStatusChanged', false);
            }
            
            // Clean up resources without trying to communicate with lost device
            if (this.reader) {
                try {
                    this.reader.releaseLock();
                } catch (e) {
                    console.log('Reader already released or unavailable');
                }
                this.reader = null;
            }
            
            if (this.writer) {
                try {
                    this.writer.releaseLock();
                } catch (e) {
                    console.log('Writer already released or unavailable');
                }
                this.writer = null;
            }
            
            // Don't try to close the port if device is lost
            this.port = null;
            
            console.log('Device lost cleanup completed');
            
        } catch (error) {
            console.error('Error during device lost cleanup:', error);
        }
    }
}

// Global instance
window.binarySerial = new BinarySerialHandler();

// File download/upload utilities for configuration import/export
window.downloadFile = function(filename, content, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up the URL object
    URL.revokeObjectURL(url);
};

window.uploadFile = function(acceptedTypes) {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = acceptedTypes || '*';
        input.style.display = 'none';
        
        input.onchange = function(event) {
            const file = event.target.files[0];
            if (!file) {
                resolve(''); // User cancelled
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function(e) {
                reject(new Error('Failed to read file: ' + e.target.error));
            };
            reader.readAsText(file);
        };
        
        input.oncancel = function() {
            resolve(''); // User cancelled
        };
        
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    });
};