// Get browser language
const userLang = (navigator.language || navigator.userLanguage).startsWith('ja') ? 'ja' : 'en';

// Language resource dictionary
const t = {
    title: userLang === 'ja' ? "PDFページマネージャー" : "PDF Page Manager",
    exportBtn: userLang === 'ja' ? "PDFとして保存" : "Save as PDF",
    dropzoneText: userLang === 'ja' ? "ここにPDFファイルをドラッグ＆ドロップして追加" : "Drag and drop PDF files here to add",
    processing: userLang === 'ja' ? "処理中..." : "Processing...",
    notPdfError: (name) => userLang === 'ja' ? `${name} はPDFファイルではありません。` : `${name} is not a PDF file.`,
    loadError: (name) => userLang === 'ja' ? `${name} の読み込みに失敗しました。` : `Failed to load ${name}.`,
    deleteBtn: userLang === 'ja' ? "削除" : "Delete",
    saveError: userLang === 'ja' ? "PDFの保存に失敗しました。" : "Failed to save PDF."
};

// Array to hold application state
let allPages = [];
// Counter for generating unique IDs
let pageCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI text
    document.title = t.title;
    document.getElementById('appTitle').textContent = t.title;
    document.getElementById('exportBtn').textContent = t.exportBtn;
    document.getElementById('dropzoneText').textContent = t.dropzoneText;
    document.getElementById('loadingText').textContent = t.processing;

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const pagesContainer = document.getElementById('pagesContainer');
    const exportBtn = document.getElementById('exportBtn');
    const loadingOverlay = document.getElementById('loading');

    // Initialize SortableJS (for drag & drop reordering)
    new Sortable(pagesContainer, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: updateExportButtonState
    });

    // Open file selection dialog on dropzone click
    dropzone.addEventListener('click', () => fileInput.click());

    // Drag & drop event handling
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    // File selection event handling
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
        fileInput.value = ''; // Clear so the same file can be selected again
    });

    // Export button processing
    exportBtn.addEventListener('click', exportPDF);

    // Function to process files
    async function handleFiles(files) {
        showLoading();
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.type !== 'application/pdf') {
                alert(t.notPdfError(file.name));
                continue;
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                await processPDF(arrayBuffer, file.name);
            } catch (error) {
                console.error('Error loading PDF:', error);
                alert(t.loadError(file.name));
            }
        }
        
        updateExportButtonState();
        hideLoading();
    }

    // Function to split and display PDF by page
    async function processPDF(arrayBuffer, fileName) {
        // Generate preview image with PDF.js and parse PDF structure with pdf-lib
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // 1. Load PDF with pdf-lib (for later extraction/merging)
        const pdfDoc = await PDFLib.PDFDocument.load(uint8Array);
        const pageCount = pdfDoc.getPageCount();

        // 2. Parse with pdf.js (for preview)
        const pdfJsDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;

        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            const id = `page-${Date.now()}-${pageCounter++}`;
            
            // Copy the corresponding page (1-based from PDFLib)
            const copiedPages = await PDFLib.PDFDocument.create().then(async doc => {
                const [copiedPage] = await doc.copyPages(pdfDoc, [pageNum - 1]);
                doc.addPage(copiedPage);
                const bytes = await doc.save();
                return await PDFLib.PDFDocument.load(bytes);
            });

            // Generate preview image (DataURL)
            const pageData = await pdfJsDoc.getPage(pageNum);
            const scale = 1.0; 
            const viewport = pageData.getViewport({ scale: scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await pageData.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            const previewUrl = canvas.toDataURL('image/jpeg');

            // Save page information
            const pageInfo = {
                id: id,
                pdfBytes: await copiedPages.save(), // PDF data for single page
                sourceFile: fileName,
                sourcePageNum: pageNum
            };
            allPages.push(pageInfo);

            // Create UI elements
            createPageCard(pageInfo, previewUrl);
        }
    }

    // Function to add preview card to DOM
    function createPageCard(pageInfo, previewUrl) {
        const div = document.createElement('div');
        div.className = 'page-card';
        div.dataset.id = pageInfo.id;

        div.innerHTML = `
            <img src="${previewUrl}" class="page-preview" alt="Page preview">
            <div class="page-controls">
                <span class="page-number">${pageInfo.sourceFile} (p.${pageInfo.sourcePageNum})</span>
                <button class="btn-delete">${t.deleteBtn}</button>
            </div>
        `;

        pagesContainer.appendChild(div);
        
        // Delete button event listener
        div.querySelector('.btn-delete').addEventListener('click', () => {
            pagesContainer.removeChild(div);
            // No need to remove from allPages, ignored during export if not in DOM
            updateExportButtonState();
        });
    }

    // PDF export processing
    async function exportPDF() {
        showLoading();
        try {
            const combinedPdf = await PDFLib.PDFDocument.create();
            
            // Get current DOM order (as it might have been changed by SortableJS)
            const cards = pagesContainer.querySelectorAll('.page-card');
            
            for (const card of cards) {
                const pageId = card.dataset.id;
                const pageInfo = allPages.find(p => p.id === pageId);
                
                if (pageInfo) {
                    const tempPdf = await PDFLib.PDFDocument.load(pageInfo.pdfBytes);
                    const [copiedPage] = await combinedPdf.copyPages(tempPdf, [0]);
                    combinedPdf.addPage(copiedPage);
                }
            }

            const pdfBytes = await combinedPdf.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            // Create and click download link
            const a = document.createElement('a');
            a.href = url;
            a.download = `combined_document_${new Date().getTime()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('Error exporting PDF:', error);
            alert(t.saveError);
        } finally {
            hideLoading();
        }
    }

    // Toggle button enable/disable state
    function updateExportButtonState() {
        if (pagesContainer.children.length > 0) {
            exportBtn.removeAttribute('disabled');
        } else {
            exportBtn.setAttribute('disabled', 'true');
        }
    }

    function showLoading() {
        loadingOverlay.classList.remove('hidden');
    }

    function hideLoading() {
        loadingOverlay.classList.add('hidden');
    }
});