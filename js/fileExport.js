// File export utilities for test session data

// Import JSZip library (will be loaded via CDN)
// <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>

/**
 * Download a single file with specified content
 */
window.downloadFile = function(filename, content, contentType = 'text/plain') {
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

/**
 * Download multiple files as a ZIP archive
 * @param {string} zipFilename - Name of the ZIP file
 * @param {Array} files - Array of {filename, content, folder} objects
 */
window.downloadZipFile = async function(zipFilename, files) {
    try {
        // Check if JSZip is available
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not loaded. Please include JSZip script.');
        }
        
        const zip = new JSZip();
        
        // Add files to ZIP
        for (const file of files) {
            const path = file.folder ? `${file.folder}/${file.filename}` : file.filename;
            zip.file(path, file.content);
        }
        
        // Generate ZIP file
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: {
                level: 6
            }
        });
        
        // Download the ZIP file
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = zipFilename;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        
        return true;
    } catch (error) {
        console.error('Failed to create ZIP file:', error);
        return false;
    }
};

/**
 * Create a session export ZIP with all test results
 * @param {string} sessionName - Name of the session
 * @param {Array} testSlots - Array of test slot objects with results
 */
window.exportSessionAsZip = async function(sessionName, testSlots) {
    try {
        const files = [];
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const zipFilename = `${sessionName}_${timestamp}.zip`;
        
        // Add individual test CSV files with new naming format
        let csvCount = 0;
        for (const slot of testSlots) {
            if (slot.result && slot.result.csvData) {
                csvCount++;
                // New format: {SlotName}-{TargetAmperage}A.csv (without session name/date)
                const cleanSlotName = slot.name.replace(/[^a-zA-Z0-9\-_]/g, '_');
                const filename = `${cleanSlotName}-${slot.configuration.targetCurrentA}A.csv`;
                
                files.push({
                    filename: filename,
                    content: slot.result.csvData
                    // No folder parameter - files will be at root level
                });
            }
        }
        
        if (files.length === 0) {
            throw new Error('No completed test results to export');
        }
        
        const success = await window.downloadZipFile(zipFilename, files);
        
        if (success) {
            console.log(`Exported ${csvCount} test results in ${zipFilename}`);
        }
        
        return success;
    } catch (error) {
        console.error('Failed to export session:', error);
        return false;
    }
};


/**
 * Upload and read a file
 */
window.uploadFile = function(acceptedTypes = '*') {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = acceptedTypes;
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

/**
 * Check if JSZip library is loaded
 */
window.isJSZipLoaded = function() {
    return typeof JSZip !== 'undefined';
};

/**
 * Load JSZip library dynamically if not already loaded
 */
window.loadJSZip = function() {
    return new Promise((resolve, reject) => {
        if (typeof JSZip !== 'undefined') {
            resolve(true);
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error('Failed to load JSZip library'));
        document.head.appendChild(script);
    });
};