pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFiles = [];

// Drag & Drop
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length) addFiles(files);
});

function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type === 'application/pdf');
    if (!files.length) { showStatus('Please select PDF files only.', 'error'); return; }
    addFiles(files);
}

function addFiles(files) {
    files.forEach(f => pdfFiles.push({ file: f, status: 'pending' }));
    renderFileList();
    document.getElementById('files-card').style.display = 'block';
    document.getElementById('status-card').style.display = 'none';
    document.getElementById('results-card').style.display = 'none';
    document.getElementById('file-input').value = '';
}

function renderFileList() {
    const list = document.getElementById('file-list');
    const useSame = document.getElementById('same-password-checkbox').checked;
    list.innerHTML = '';

    pdfFiles.forEach((item, i) => {
        const sizeStr = item.file.size > 1048576
            ? (item.file.size / 1048576).toFixed(1) + ' MB'
            : (item.file.size / 1024).toFixed(0) + ' KB';

        const div = document.createElement('div');
        div.className = 'file-item';
        div.id = `file-item-${i}`;
        div.innerHTML = `
            <div class="file-row">
                <span class="file-icon">🔐</span>
                <div class="file-info">
                    <div class="file-name">${item.file.name}</div>
                    <div class="file-meta">${sizeStr}</div>
                </div>
                <span class="file-status-badge" id="badge-${i}">⏳ Pending</span>
                <button class="remove-btn" onclick="removeFile(${i})">✕</button>
            </div>
            ${!useSame ? `
            <div class="file-password-row">
                <div class="password-field">
                    <input type="password" id="pw-${i}" placeholder="Enter password for this file" autocomplete="off">
                    <button class="eye-btn" onclick="toggleVisibility('pw-${i}', this)">👁️</button>
                </div>
            </div>` : ''}
        `;
        list.appendChild(div);
    });
}

function toggleGlobalPassword() {
    const checked = document.getElementById('same-password-checkbox').checked;
    document.getElementById('global-input-wrap').style.display = checked ? 'block' : 'none';
    renderFileList();
}

function toggleVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function removeFile(index) {
    pdfFiles.splice(index, 1);
    if (!pdfFiles.length) {
        document.getElementById('files-card').style.display = 'none';
        document.getElementById('results-card').style.display = 'none';
    } else {
        renderFileList();
    }
}

function clearAll() {
    pdfFiles = [];
    document.getElementById('files-card').style.display = 'none';
    document.getElementById('status-card').style.display = 'none';
    document.getElementById('results-card').style.display = 'none';
    document.getElementById('same-password-checkbox').checked = false;
    document.getElementById('global-input-wrap').style.display = 'none';
}

async function processAll() {
    if (!pdfFiles.length) return;

    const useSame = document.getElementById('same-password-checkbox').checked;
    const globalPw = document.getElementById('global-password').value;

    // Validate passwords
    if (useSame && !globalPw.trim()) {
        showStatus('Please enter the password for all files.', 'error');
        return;
    }
    if (!useSame) {
        for (let i = 0; i < pdfFiles.length; i++) {
            const pw = document.getElementById(`pw-${i}`)?.value || '';
            if (!pw.trim()) {
                showStatus(`Please enter the password for: ${pdfFiles[i].file.name}`, 'error');
                return;
            }
        }
    }

    const btn = document.getElementById('process-btn');
    const btnText = document.getElementById('process-btn-text');
    btn.disabled = true;
    btnText.textContent = '⏳ Processing...';
    showStatus('Removing passwords... Please wait.', 'processing');

    document.getElementById('results-card').style.display = 'none';
    document.getElementById('results-list').innerHTML = '';

    let successCount = 0;
    let failCount = 0;
    const results = [];

    for (let i = 0; i < pdfFiles.length; i++) {
        const item = pdfFiles[i];
        const password = useSame ? globalPw : (document.getElementById(`pw-${i}`)?.value || '');
        btnText.textContent = `⏳ Processing ${i + 1} of ${pdfFiles.length}...`;
        updateBadge(i, 'processing', '⏳ Processing...');

        try {
            const arrayBuffer = await item.file.arrayBuffer();

            // Step 1: Load with PDF.js using the password
            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                password: password
            });
            const pdfJsDoc = await loadingTask.promise;
            const numPages = pdfJsDoc.numPages;

            // Step 2: Create new pdf-lib document
            const { PDFDocument } = PDFLib;
            const newPdf = await PDFDocument.create();

            // Step 3: Render each page via canvas and embed as image
            for (let p = 1; p <= numPages; p++) {
                btnText.textContent = `⏳ File ${i + 1}/${pdfFiles.length} — Page ${p}/${numPages}...`;

                const page = await pdfJsDoc.getPage(p);
                const viewport = page.getViewport({ scale: 2.0 });

                // Create offscreen canvas
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');

                await page.render({ canvasContext: ctx, viewport }).promise;

                // Convert canvas to PNG bytes
                const imgDataUrl = canvas.toDataURL('image/png');
                const imgBytes = await fetch(imgDataUrl).then(r => r.arrayBuffer());

                // Embed image in pdf-lib
                const pngImage = await newPdf.embedPng(imgBytes);
                const pdfPage = newPdf.addPage([viewport.width / 2, viewport.height / 2]);
                pdfPage.drawImage(pngImage, {
                    x: 0,
                    y: 0,
                    width: viewport.width / 2,
                    height: viewport.height / 2
                });
            }

            // Step 4: Save unlocked PDF
            const unlockedBytes = await newPdf.save();
            const blob = new Blob([unlockedBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const outName = item.file.name.replace(/\.pdf$/i, '_unlocked.pdf');

            updateBadge(i, 'success', '✅ Unlocked');
            successCount++;
            results.push({ name: outName, url, status: 'success' });

        } catch (err) {
            let errMsg = '❌ Failed';
            const msg = err.message?.toLowerCase() || '';
            if (
                err.name === 'PasswordException' ||
                msg.includes('password') ||
                msg.includes('incorrect') ||
                err.code === 1 ||
                err.code === 2
            ) {
                errMsg = '❌ Wrong password';
            }
            updateBadge(i, 'error', errMsg);
            failCount++;
            results.push({ name: item.file.name, url: null, status: 'error', errMsg });
        }
    }

    showResults(results, successCount, failCount);
    btn.disabled = false;
    btnText.textContent = '🔓 Remove Passwords';
}

function updateBadge(index, type, text) {
    const badge = document.getElementById(`badge-${index}`);
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'file-status-badge';
    if (type === 'success') badge.classList.add('badge-success');
    else if (type === 'error') badge.classList.add('badge-error');
    else if (type === 'processing') badge.classList.add('badge-processing');
}

function showResults(results, successCount, failCount) {
    const card = document.getElementById('results-card');
    const list = document.getElementById('results-list');
    card.style.display = 'block';
    list.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'results-summary';
    summary.innerHTML = `
        <span class="summary-success">✅ ${successCount} unlocked</span>
        ${failCount > 0 ? `<span class="summary-error">❌ ${failCount} failed</span>` : ''}
    `;
    list.appendChild(summary);

    results.forEach(r => {
        const div = document.createElement('div');
        div.className = `result-item ${r.status === 'success' ? 'result-success' : 'result-error'}`;
        if (r.status === 'success') {
            div.innerHTML = `
                <span class="result-name">📄 ${r.name}</span>
                <a href="${r.url}" download="${r.name}" class="download-btn">⬇️ Download</a>
            `;
        } else {
            div.innerHTML = `
                <span class="result-name">📄 ${r.name}</span>
                <span class="result-err-msg">${r.errMsg}</span>
            `;
        }
        list.appendChild(div);
    });

    // Download all button if multiple successes
    if (successCount > 1) {
        const downloadAll = document.createElement('button');
        downloadAll.className = 'download-all-btn';
        downloadAll.textContent = `⬇️ Download All Unlocked (${successCount})`;
        downloadAll.onclick = () => {
            results.filter(r => r.status === 'success').forEach((r, idx) => {
                setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = r.url;
                    a.download = r.name;
                    a.click();
                }, idx * 300);
            });
        };
        list.appendChild(downloadAll);
    }

    showStatus(
        successCount > 0
            ? `✅ ${successCount} file(s) unlocked successfully!${failCount > 0 ? ` ${failCount} failed.` : ''}`
            : `❌ All files failed. Please check your passwords.`,
        successCount > 0 ? 'success' : 'error'
    );
}

function showStatus(html, type) {
    const card = document.getElementById('status-card');
    card.style.display = 'block';
    card.innerHTML = html;
    card.className = 'status-card';
    if (type === 'error') card.style.borderLeft = '4px solid #e74c3c';
    else if (type === 'success') card.style.borderLeft = '4px solid #27ae60';
    else card.style.borderLeft = '4px solid #667eea';
}
