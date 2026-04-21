// アプリケーションの状態を保持する配列
let allPages = [];
// 一意のIDを生成するためのカウンター
let pageCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const pagesContainer = document.getElementById('pagesContainer');
    const exportBtn = document.getElementById('exportBtn');
    const loadingOverlay = document.getElementById('loading');

    // SortableJSの初期化（ドラッグ＆ドロップでの並び替え用）
    new Sortable(pagesContainer, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: updateExportButtonState
    });

    // ドロップゾーンのクリックでファイル選択ダイアログを開く
    dropzone.addEventListener('click', () => fileInput.click());

    // ドラッグ＆ドロップのイベント処理
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

    // ファイル選択のイベント処理
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
        fileInput.value = ''; // 同じファイルを再度選択できるようにクリア
    });

    // エクスポートボタンの処理
    exportBtn.addEventListener('click', exportPDF);

    // ファイルを処理する関数
    async function handleFiles(files) {
        showLoading();
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.type !== 'application/pdf') {
                alert(`${file.name} はPDFファイルではありません。`);
                continue;
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                await processPDF(arrayBuffer, file.name);
            } catch (error) {
                console.error('PDFの読み込みエラー:', error);
                alert(`${file.name} の読み込みに失敗しました。`);
            }
        }
        
        updateExportButtonState();
        hideLoading();
    }

    // PDFをページ単位に分割して表示する関数
    async function processPDF(arrayBuffer, fileName) {
        // PDF.jsでプレビュー画像を生成し、pdf-libでPDF構造をパースする
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // 1. pdf-libでPDFをロード（後で結合・抽出するため）
        const pdfDoc = await PDFLib.PDFDocument.load(uint8Array);
        const pageCount = pdfDoc.getPageCount();

        // 2. pdf.jsでパース（プレビュー用）
        const pdfJsDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;

        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            const id = `page-${Date.now()}-${pageCounter++}`;
            
            // 該当ページをコピーしておく (1-based from PDFLib)
            const copiedPages = await PDFLib.PDFDocument.create().then(async doc => {
                const [copiedPage] = await doc.copyPages(pdfDoc, [pageNum - 1]);
                doc.addPage(copiedPage);
                const bytes = await doc.save();
                return await PDFLib.PDFDocument.load(bytes);
            });

            // プレビュー用の画像(DataURL)を生成
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

            // ページ情報の保存
            const pageInfo = {
                id: id,
                pdfBytes: await copiedPages.save(), // そのページ単体のPDFデータ
                sourceFile: fileName,
                sourcePageNum: pageNum
            };
            allPages.push(pageInfo);

            // UI要素の作成
            createPageCard(pageInfo, previewUrl);
        }
    }

    // プレビューカードをDOMに追加する関数
    function createPageCard(pageInfo, previewUrl) {
        const div = document.createElement('div');
        div.className = 'page-card';
        div.dataset.id = pageInfo.id;

        div.innerHTML = `
            <img src="${previewUrl}" class="page-preview" alt="Page preview">
            <div class="page-controls">
                <span class="page-number">${pageInfo.sourceFile} (p.${pageInfo.sourcePageNum})</span>
                <button class="btn-delete" onclick="deletePage('${pageInfo.id}')">削除</button>
            </div>
        `;

        pagesContainer.appendChild(div);
        
        // 削除ボタンのイベントリスナー
        div.querySelector('.btn-delete').addEventListener('click', () => {
            pagesContainer.removeChild(div);
            // allPages配下からは消さなくてもDOMがないのでExport時に無視できる
            updateExportButtonState();
        });
    }

    // PDFエクスポート処理
    async function exportPDF() {
        showLoading();
        try {
            const combinedPdf = await PDFLib.PDFDocument.create();
            
            // 現在のDOMの順序を取得（SortableJSで変更されている可能性があるため）
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
            
            // ダウンロードリンクを生成してクリック
            const a = document.createElement('a');
            a.href = url;
            a.download = `combined_document_${new Date().getTime()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('PDFのエクスポートエラー:', error);
            alert('PDFの保存に失敗しました。');
        } finally {
            hideLoading();
        }
    }

    // ボタンの有効/無効を切り替える
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