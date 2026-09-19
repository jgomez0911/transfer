(async function runQcDataExtraction() {
    const eventId = prompt("Enter the Event ID:");
    if (!eventId) {
        console.warn("Operation cancelled: No Event ID provided.");
        return;
    }

    // =========================================================================
    // 1. CONFIGURATION: URLS & TARGET COLUMN TITLES
    // =========================================================================
    const urls = {
        base: `https://your-domain.internal/events/S${eventId}`,
        sfhd_list: `https://your-domain.internal/sfhd/list?eventId=${eventId}`,
        sfhd_record: (id) => `https://your-domain.internal/sfhd/record/${id}`,
        col_list: `https://your-domain.internal/collateral/list?eventId=${eventId}`,
        col_record: (id) => `https://your-domain.internal/collateral/record/${id}`
    };

    // Exact or partial titles found inside spans, buttons, or th elements
    const COLUMN_TITLES = {
        overview: [
            "Mod Type", "Acct System", "Borrower Name", "Borrower ID",
            "Loan ID", "Product ID", "Synd/Part Type", "Product",
            "Commit Amt", "Prop Commit", "Cur Balance", "Loan Status", "Status Detail"
        ],
        determinations: [
            "Det ID", "Flood Cert ID", "Cert Borrower Name", "Borrower ID",
            "Cert Loan ID", "Address", "City", "State", "Zip", "Flood Zone"
        ],
        collateral: [
            "Collat ID", "Name", "Type", "Sub-type", "Address", "City",
            "State", "Zip", "County Subdiv", "Sec", "Lot", "Block"
        ],
        documents: {
            id: "Doc ID",
            name: "Doc Name",
            notes: "Notes"
        }
    };

    // =========================================================================
    // 2. SEARCH & EXTRACTION HELPERS (HEADER-MATCHING ENGINE)
    // =========================================================================

    // Normalizes text by removing extra spaces, newlines, and lowercase conversion
    function cleanText(text) {
        return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // Scans the table headers (spans, buttons, or ths) and maps title -> column index
    function getTableColumnMap(table) {
        const colMap = {};
        if (!table) return colMap;

        // Collect all potential header cells from thead or the first row
        const headerCells = Array.from(table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td'));

        headerCells.forEach((cell, idx) => {
            // innerText ignores whether text is in a <span>, <button>, or <div>
            const headerText = cleanText(cell.innerText);
            if (headerText) {
                colMap[headerText] = idx;
            }
        });

        return colMap;
    }

    // Finds column index by matching your configured title against the mapped headers
    function findColumnIndex(colMap, searchTitle) {
        const target = cleanText(searchTitle);
        // Direct match
        if (colMap[target] !== undefined) return colMap[target];

        // Fuzzy/partial match (e.g. "loan id" inside "loan id #")
        for (const [headerText, index] of Object.entries(colMap)) {
            if (headerText.includes(target) || target.includes(headerText)) {
                return index;
            }
        }
        return -1;
    }

    // Extracts text and any link (anchor tag) within a specific cell
    function extractCellData(cell) {
        if (!cell) return { text: '-', url: null };

        const anchor = cell.querySelector('a');
        const text = cell.innerText.trim() || '-';
        const url = anchor ? anchor.href : null;

        return { text, url };
    }

    // Helper: Extracts a full row by matching an array of expected titles
    function extractRowByTitles(rowElement, colMap, titleList) {
        return titleList.map(title => {
            const colIndex = findColumnIndex(colMap, title);
            if (colIndex !== -1 && rowElement.children[colIndex]) {
                return extractCellData(rowElement.children[colIndex]);
            }
            return { text: '-', url: null };
        });
    }

    // Helper to format documents into horizontal rows (max 3 per row)
    function renderDocumentGrid(docs) {
        if (!docs || docs.length === 0) {
            return '<p style="margin: 0; color: #777777; font-style: italic; font-size: 8pt;">No associated documents indexed.</p>';
        }
        let gridRows = '';
        for (let i = 0; i < docs.length; i += 3) {
            const chunk = docs.slice(i, i + 3);
            gridRows += '<tr>';
            chunk.forEach((d, idx) => {
                const padding = idx === 0 ? 'padding: 2px 10px 2px 0;' : (idx === 1 ? 'padding: 2px 10px 2px 5px;' : 'padding: 2px 0 2px 10px;');
                const docLabel = d.url 
                    ? `<a href="${escapeHtml(d.url)}" style="color: #A6192E; text-decoration: underline;">${escapeHtml(d.docName)}: ${escapeHtml(d.docId)}</a>`
                    : `${escapeHtml(d.docName)}: ${escapeHtml(d.docId)}`;

                gridRows += `
                    <td style="width: 33.33%; vertical-align: top; ${padding} border: none;">
                        <p style="margin: 0; font-weight: bold; color: #222222; font-size: 8pt;">${docLabel}</p>
                        <p style="margin: 2px 0 0 0; color: #444444; font-size: 8pt;">${escapeHtml(d.note || '-')}</p>
                    </td>
                `;
            });
            for (let pad = chunk.length; pad < 3; pad++) {
                gridRows += '<td style="width: 33.33%; border: none;"></td>';
            }
            gridRows += '</tr>';
        }

        return `
            <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: collapse; width: 100%; border: none; font-size: 8pt; table-layout: fixed;">
                ${gridRows}
            </table>
        `;
    }

    // --- 3. DOM FETCH & DOCUMENT EXTRACTOR ---
    async function fetchDoc(url) {
        console.log(`Fetching: ${url}`);
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
        const html = await res.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    async function extractRecordDocs(recordUrl) {
        try {
            const doc = await fetchDoc(recordUrl);
            const docTable = doc.querySelector('.document-section-div table, table');
            if (!docTable) return [];

            const colMap = getTableColumnMap(docTable);
            const idIdx = findColumnIndex(colMap, COLUMN_TITLES.documents.id);
            const nameIdx = findColumnIndex(colMap, COLUMN_TITLES.documents.name);
            const notesIdx = findColumnIndex(colMap, COLUMN_TITLES.documents.notes);

            const rows = Array.from(docTable.querySelectorAll('tbody tr, tr:not(:first-child)'));
            const records = [];

            rows.forEach(tr => {
                // Ignore sub-rows or empty rows
                if (tr.children.length < 2) return;

                const idCell = extractCellData(tr.children[idIdx !== -1 ? idIdx : 0]);
                const nameCell = extractCellData(tr.children[nameIdx !== -1 ? nameIdx : 1]);
                
                // Notes could be in an indexed cell, a sibling .notes-row, or adjacent column
                let noteText = '';
                if (notesIdx !== -1 && tr.children[notesIdx]) {
                    noteText = tr.children[notesIdx].innerText.trim();
                } else if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('notes-row')) {
                    noteText = tr.nextElementSibling.innerText.trim();
                } else {
                    const fallbackNotes = tr.querySelector('.doc-notes, .notes');
                    noteText = fallbackNotes ? fallbackNotes.innerText.trim() : '';
                }

                if (idCell.text !== '-' || nameCell.text !== '-') {
                    records.push({
                        docId: idCell.text,
                        docName: nameCell.text,
                        url: idCell.url || nameCell.url,
                        note: noteText
                    });
                }
            });
            return records;
        } catch (err) {
            console.error(`Error reading record: ${recordUrl}`, err);
            return [];
        }
    }

    // =========================================================================
    // 4. MAIN EXTRACTION PIPELINE
    // =========================================================================
    try {
        console.log(`Extracting data for Event: ${eventId}...`);

        // --- STEP 1: EVENT OVERVIEW (Base Table Search) ---
        let overviewCells = [];
        try {
            const baseDoc = await fetchDoc(urls.base);
            const baseTable = baseDoc.querySelector('#event-overview-div table, table');
            if (baseTable) {
                const colMap = getTableColumnMap(baseTable);
                const firstRow = baseTable.querySelector('tbody tr, tr:nth-child(2)');
                if (firstRow) {
                    overviewCells = extractRowByTitles(firstRow, colMap, COLUMN_TITLES.overview);
                }
            }
        } catch (e) {
            console.warn("Base overview lookup failed; fallback to blank fields.", e);
        }

        while (overviewCells.length < COLUMN_TITLES.overview.length) {
            overviewCells.push({ text: '-', url: null });
        }

        // --- STEP 2: DETERMINATIONS (SFHD List & Records) ---
        const sfhdDoc = await fetchDoc(urls.sfhd_list);
        const sfhdTable = sfhdDoc.querySelector('#sfhd-table, table');
        const sfhdColMap = getTableColumnMap(sfhdTable);
        const sfhdRows = Array.from(sfhdTable ? sfhdTable.querySelectorAll('tbody tr, tr:not(:first-child)') : []);
        const sfhdData = [];

        for (const row of sfhdRows) {
            const extractedRow = extractRowByTitles(row, sfhdColMap, COLUMN_TITLES.determinations);
            const detIdObj = extractedRow[0]; // "Det ID"
            if (!detIdObj || detIdObj.text === '-') continue;

            const recordUrl = detIdObj.url || urls.sfhd_record(detIdObj.text);
            const docs = await extractRecordDocs(recordUrl);

            sfhdData.push({
                cells: extractedRow,
                addressSource: row.querySelector('.address-source')?.innerText?.trim() || '',
                docs: docs
            });
            await new Promise(r => setTimeout(r, 200));
        }

        // --- STEP 3: COLLATERAL LIST & RECORDS ---
        const colDoc = await fetchDoc(urls.col_list);
        const colTable = colDoc.querySelector('#collateral-table, table');
        const colMap = getTableColumnMap(colTable);
        const colRows = Array.from(colTable ? colTable.querySelectorAll('tbody tr, tr:not(:first-child)') : []);
        const colData = [];

        for (const row of colRows) {
            const extractedRow = extractRowByTitles(row, colMap, COLUMN_TITLES.collateral);
            const colIdObj = extractedRow[0]; // "Collat ID"
            if (!colIdObj || colIdObj.text === '-') continue;

            const recordUrl = colIdObj.url || urls.col_record(colIdObj.text);
            const docs = await extractRecordDocs(recordUrl);

            colData.push({
                cells: extractedRow,
                docs: docs
            });
            await new Promise(r => setTimeout(r, 200));
        }

        // --- STEP 4: GENERAL DOCUMENTS POOL ---
        const seenDocs = new Set();
        const pooledDocs = [];
        [...sfhdData, ...colData].forEach(item => {
            item.docs.forEach(d => {
                if (!seenDocs.has(d.docId)) {
                    seenDocs.add(d.docId);
                    pooledDocs.push(d);
                }
            });
        });

        // =========================================================================
        // 5. BUILD EXCEL-STYLE REPORT HTML (WELLS FARGO THEME)
        // =========================================================================
        const compiledHtml = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #222222; line-height: 1.35; }
                h1 { font-size: 16pt; font-weight: bold; color: #A6192E; margin: 0; }
                h2 { mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
                table { border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; table-layout: fixed; word-break: break-word; }
                th { background-color: #A6192E; color: #FFFFFF; font-weight: bold; border: 1px solid #B84353; padding: 5px 2px; text-align: center; }
                td { border: 1px solid #CCCCCC; padding: 4px 2px; }
            </style>
        </head>
        <body style="font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #222222;">

            <!-- Header Banner -->
            <div style="border-bottom: 4px solid #A6192E; padding-bottom: 6px; margin-bottom: 18px;">
                <table border="0" cellpadding="0" cellspacing="0" style="width: 100%; border: none;">
                    <tr>
                        <td style="border: none; vertical-align: bottom;">
                            <h1 style="font-size: 16pt; font-weight: bold; color: #A6192E; margin: 0; letter-spacing: 0.3px;">
                                QC Review &mdash; Event: <span style="color: #222222;">${escapeHtml(eventId)}</span>
                            </h1>
                        </td>
                        <td style="border: none; text-align: right; vertical-align: bottom;">
                            <div style="display: inline-block; width: 45px; height: 5px; background-color: #F4A900;"></div>
                        </td>
                    </tr>
                </table>
            </div>

            <!-- 1. Event Overview -->
            <div style="margin-bottom: 22px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 6px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Event Overview
                    </h2>
                </div>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; font-size: 7.2pt; table-layout: fixed; word-break: break-word;">
                    <thead>
                        <tr style="background-color: #A6192E; color: #FFFFFF; text-align: center;">
                            ${COLUMN_TITLES.overview.map(title => `<th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">${escapeHtml(title)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="text-align: center; background-color: #FFFFFF;">
                            ${overviewCells.map(c => `
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">
                                    ${c.url ? `<a href="${escapeHtml(c.url)}" style="color: #A6192E; font-weight: bold;">${escapeHtml(c.text)}</a>` : escapeHtml(c.text)}
                                </td>
                            `).join('')}
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- 2. Determinations -->
            <div style="margin-bottom: 22px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 6px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Determinations
                    </h2>
                </div>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; font-size: 7.5pt; table-layout: fixed; word-break: break-word;">
                    <thead>
                        <tr style="background-color: #A6192E; color: #FFFFFF; text-align: center;">
                            ${COLUMN_TITLES.determinations.map(title => `<th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">${escapeHtml(title)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${sfhdData.map(item => `
                            <tr style="text-align: center; background-color: #FFFFFF;">
                                ${item.cells.map(c => `
                                    <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">
                                        ${c.url ? `<a href="${escapeHtml(c.url)}" style="color: #A6192E; font-weight: bold;">${escapeHtml(c.text)}</a>` : escapeHtml(c.text)}
                                    </td>
                                `).join('')}
                            </tr>
                            <tr style="background-color: #FDFBF7;">
                                <td colspan="${COLUMN_TITLES.determinations.length}" style="border: 1px solid #CCCCCC; padding: 6px 10px; border-left: 3px solid #F4A900;">
                                    <div style="font-size: 8pt; margin-bottom: 6px;">
                                        <div style="font-weight: bold; color: #A6192E;">Address verification source:</div>
                                        <div style="color: #333333; margin-top: 1px;">${escapeHtml(item.addressSource) || '&nbsp;'}</div>
                                    </div>
                                    ${renderDocumentGrid(item.docs)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- 3. Collateral -->
            <div style="margin-bottom: 22px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 6px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Collateral
                    </h2>
                </div>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; font-size: 7.2pt; table-layout: fixed; word-break: break-word;">
                    <thead>
                        <tr style="background-color: #A6192E; color: #FFFFFF; text-align: center;">
                            ${COLUMN_TITLES.collateral.map(title => `<th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">${escapeHtml(title)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${colData.map(item => `
                            <tr style="text-align: center; background-color: #FFFFFF;">
                                ${item.cells.map(c => `
                                    <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">
                                        ${c.url ? `<a href="${escapeHtml(c.url)}" style="color: #A6192E; font-weight: bold;">${escapeHtml(c.text)}</a>` : escapeHtml(c.text)}
                                    </td>
                                `).join('')}
                            </tr>
                            <tr style="background-color: #FDFBF7;">
                                <td colspan="${COLUMN_TITLES.collateral.length}" style="border: 1px solid #CCCCCC; padding: 6px 10px; border-left: 3px solid #F4A900;">
                                    ${renderDocumentGrid(item.docs)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- 4. Documents -->
            <div style="margin-bottom: 15px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 8px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Documents
                    </h2>
                </div>
                <div style="font-size: 8.5pt; line-height: 1.4; padding-left: 2px;">
                    ${pooledDocs.length > 0 ? pooledDocs.map(d => `
                        <div style="margin-bottom: 8px;">
                            <p style="margin: 0; font-weight: bold; color: #222222;">
                                ${d.url ? `<a href="${escapeHtml(d.url)}" style="color: #A6192E; text-decoration: underline;">${escapeHtml(d.docName)}: ${escapeHtml(d.docId)}</a>` : `${escapeHtml(d.docName)}: ${escapeHtml(d.docId)}`}
                            </p>
                            <p style="margin: 1px 0 0 0; color: #444444;">${escapeHtml(d.note || '-')}</p>
                        </div>
                    `).join('') : '<p style="margin: 0; color: #777777; font-style: italic;">No independent documents found.</p>'}
                </div>
            </div>

            <!-- Footer -->
            <div style="margin-top: 30px; border-top: 1px solid #DDDDDD; padding-top: 6px; font-size: 7.5pt; color: #888888; text-align: center;">
                Internal QC Review &bull; Confidential
            </div>
        </body>
        </html>`;

        // =========================================================================
        // 6. CLIPBOARD SELECTION COPY & DOC DOWNLOAD
        // =========================================================================
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'fixed';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '0';
        tempDiv.innerHTML = compiledHtml;
        document.body.appendChild(tempDiv);

        const range = document.createRange();
        range.selectNodeContents(tempDiv);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (e) {
            console.warn("execCommand failed, falling back to Clipboard API...", e);
        }
        sel.removeAllRanges();
        document.body.removeChild(tempDiv);

        if (!copied && navigator.clipboard) {
            const blobHtml = new Blob([compiledHtml], { type: 'text/html' });
            const blobPlain = new Blob([compiledHtml], { type: 'text/plain' });
            await navigator.clipboard.write([
                new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobPlain })
            ]);
            copied = true;
        }

        if (copied) {
            console.log("Rich report copied to clipboard! Paste directly into Word or OneNote.");
        }

        const docBlob = new Blob(['\ufeff', compiledHtml], { type: 'application/msword' });
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(docBlob);
        downloadLink.download = `QC_Report_Event_${eventId}.doc`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        console.log(`QC Extraction completed successfully for Event ${eventId}.`);

    } catch (error) {
        console.error("Scraping workflow failed:", error);
    }
})();
