(async function runQcDataExtraction() {
    const eventId = prompt("Enter the Event ID:");
    if (!eventId) {
        console.warn("Operation cancelled: No Event ID provided.");
        return;
    }

    // --- 1. CONFIGURATION & SELECTORS ---
    // Update the URL patterns and CSS selectors below to match your portal's DOM
    const urls = {
        base: `https://your-domain.internal/events/S${eventId}`,
        sfhd_list: `https://your-domain.internal/sfhd/list?eventId=${eventId}`,
        sfhd_record: (id) => `https://your-domain.internal/sfhd/record/${id}`,
        col_list: `https://your-domain.internal/collateral/list?eventId=${eventId}`,
        col_record: (id) => `https://your-domain.internal/collateral/record/${id}`
    };

    const SELECTORS = {
        baseTableContainer: '#event-overview-div table',     // Selector for the primary overview table
        sfhdListRows: '#sfhd-table tbody tr',                 // Rows in SFHD list
        colListRows: '#collateral-table tbody tr',            // Rows in Collateral list
        docContainer: '.document-section-div',                // Div holding documents in a record
        docRows: '.document-section-div table tbody tr',      // Rows inside the document table
    };

    // --- 2. DOM FETCH HELPER ---
    async function fetchDoc(url) {
        console.log(`Fetching: ${url}`);
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
        const html = await res.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    // --- 3. DOCUMENT DETAIL EXTRACTOR ---
    async function extractRecordDocs(recordUrl) {
        try {
            const doc = await fetchDoc(recordUrl);
            const rows = Array.from(doc.querySelectorAll(SELECTORS.docRows));
            const records = [];

            // Assumes doc rows alternate or contain ID, Name, and Notes
            rows.forEach(tr => {
                const docId = tr.querySelector('.doc-id')?.innerText?.trim() || 'N/A';
                const docName = tr.querySelector('.doc-name')?.innerText?.trim() || 'N/A';
                // Grabs following TR or sibling cell containing the note
                const noteTr = tr.nextElementSibling?.classList.contains('notes-row')
                    ? tr.nextElementSibling.innerText.trim()
                    : tr.querySelector('.doc-notes')?.innerText?.trim() || 'None';

                if (docId !== 'N/A' || docName !== 'N/A') {
                    records.push({ docId, docName, note: noteTr });
                }
            });
            return records;
        } catch (err) {
            console.error(`Error loading record: ${recordUrl}`, err);
            return [];
        }
    }

    try {
        console.log(`Starting extraction for Event: ${eventId}...`);

        // --- STEP 1: Fetch Base Table ---
        const baseDoc = await fetchDoc(urls.base);
        const baseTable = baseDoc.querySelector(SELECTORS.baseTableContainer);
        const baseTableHtml = baseTable ? baseTable.outerHTML : '<p>Base table not found.</p>';

        // --- STEP 2: SFHD List & Records ---
        const sfhdDoc = await fetchDoc(urls.sfhd_list);
        const sfhdRows = Array.from(sfhdDoc.querySelectorAll(SELECTORS.sfhdListRows));
        const sfhdData = [];

        for (const row of sfhdRows) {
            const sfhdId = row.querySelector('.sfhd-id')?.innerText?.trim();
            const recordNum = row.querySelector('.sfhd-rec-num')?.innerText?.trim();
            if (!sfhdId) continue;

            const docs = await extractRecordDocs(urls.sfhd_record(sfhdId));
            sfhdData.push({ sfhdId, recordNum, docs });
        }

        // --- STEP 3: Collateral List & Records ---
        const colDoc = await fetchDoc(urls.col_list);
        const colRows = Array.from(colDoc.querySelectorAll(SELECTORS.colListRows));
        const colData = [];

        for (const row of colRows) {
            const colId = row.querySelector('.col-id')?.innerText?.trim();
            const recordNum = row.querySelector('.col-rec-num')?.innerText?.trim();
            if (!colId) continue;

            const docs = await extractRecordDocs(urls.col_record(colId));
            colData.push({ colId, recordNum, docs });
        }

        // --- STEP 4: GENERATE STYLED HTML FOR WORD / ONENOTE ---
        let compiledHtml = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #333; }
                h1 { color: #A6192E; font-size: 18pt; border-bottom: 2px solid #A6192E; }
                h2 { color: #333; font-size: 14pt; margin-top: 20px; }
                h3 { color: #555; font-size: 12pt; }
                table { border-collapse: collapse; width: 100%; margin-bottom: 15px; font-size: 10pt; }
                th { background-color: #f2f2f2; border: 1px solid #ccc; padding: 6px; text-align: left; }
                td { border: 1px solid #ccc; padding: 6px; vertical-align: top; }
                .note-box { background-color: #fafafa; font-style: italic; color: #444; }
            </style>
        </head>
        <body>
            <h1>QC Extraction Report - Event: ${eventId}</h1>
            <h2>Event Overview</h2>
            ${baseTableHtml}

            <h2>Determinations (SFHD)</h2>
            ${sfhdData.map(item => `
                <h3>SFHD ID: ${item.sfhdId} \vert{} Record #: ${item.recordNum}</h3>
                <table>
                    <thead><tr><th style="width:20%">Doc ID</th><th style="width:30%">Doc Name</th><th style="width:50%">Notes</th></tr></thead>
                    <tbody>
                        ${item.docs.map(d => `
                            <tr>
                                <td>${d.docId}</td>
                                <td>${d.docName}</td>
                                <td class="note-box">${d.note}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            `).join('')}

            <h2>Collateral Records</h2>
            ${colData.map(item => `
                <h3>Collateral ID: ${item.colId} \vert{} Record #: ${item.recordNum}</h3>
                <table>
                    <thead><tr><th style="width:20%">Doc ID</th><th style="width:30%">Doc Name</th><th style="width:50%">Notes</th></tr></thead>
                    <tbody>
                        ${item.docs.map(d => `
                            <tr>
                                <td>${d.docId}</td>
                                <td>${d.docName}</td>
                                <td class="note-box">${d.note}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            `).join('')}
        </body>
        </html>`;

        // --- STEP 5: CLIPBOARD COPY & FILE DOWNLOAD ---
        // 1. Copy formatted rich text directly to clipboard for direct Ctrl+V into OneNote/Word
        const blobHtml = new Blob([compiledHtml], { type: 'text/html' });
        const blobPlain = new Blob([compiledHtml], { type: 'text/plain' });
        await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobPlain })
        ]);
        console.log("Rich formatting copied to clipboard! You can paste directly into Word or OneNote.");

        // 2. Trigger .doc file download for desktop Word
        const docBlob = new Blob(['\ufeff', compiledHtml], { type: 'application/msword' });
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(docBlob);
        downloadLink.download = `QC_Report_Event_${eventId}.doc`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

    } catch (error) {
        console.error("Scraping workflow failed:", error);
    }
})();