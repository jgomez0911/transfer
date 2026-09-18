(async function runQcDataExtraction() {
    const eventId = prompt("Enter the Event ID:");
    if (!eventId) {
        console.warn("Operation cancelled: No Event ID provided.");
        return;
    }

    // --- 1. CONFIGURATION & SELECTORS ---
    // Update the URL patterns and CSS selectors to match your portal's DOM
    const urls = {
        base: `https://your-domain.internal/events/S${eventId}`,
        sfhd_list: `https://your-domain.internal/sfhd/list?eventId=${eventId}`,
        sfhd_record: (id) => `https://your-domain.internal/sfhd/record/${id}`,
        col_list: `https://your-domain.internal/collateral/list?eventId=${eventId}`,
        col_record: (id) => `https://your-domain.internal/collateral/record/${id}`,
        docs_list: `https://your-domain.internal/documents/list?eventId=${eventId}` // Optional standalone doc page
    };

    const SELECTORS = {
        baseTableContainer: '#event-overview-div table',
        baseTableCells: '#event-overview-div table tbody tr td',
        sfhdListRows: '#sfhd-table tbody tr',
        colListRows: '#collateral-table tbody tr',
        docRows: '.document-section-div table tbody tr',
        standaloneDocRows: '#documents-table tbody tr'
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
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
                gridRows += `
                    <td style="width: 33.33%; vertical-align: top; ${padding} border: none;">
                        <p style="margin: 0; font-weight: bold; color: #222222; font-size: 8pt;">${escapeHtml(d.docName)}: ${escapeHtml(d.docId)}</p>
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

            rows.forEach(tr => {
                const docId = tr.querySelector('.doc-id')?.innerText?.trim() || tr.children[0]?.innerText?.trim() || 'N/A';
                const docName = tr.querySelector('.doc-name')?.innerText?.trim() || tr.children[1]?.innerText?.trim() || 'N/A';
                const noteTr = tr.nextElementSibling?.classList.contains('notes-row')
                    ? tr.nextElementSibling.innerText.trim()
                    : tr.querySelector('.doc-notes')?.innerText?.trim() || tr.children[2]?.innerText?.trim() || '';

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

        // --- STEP 1: Fetch Base Table Data (13 Columns) ---
        let baseCells = [];
        try {
            const baseDoc = await fetchDoc(urls.base);
            const extractedCells = Array.from(baseDoc.querySelectorAll(SELECTORS.baseTableCells)).map(td => td.innerText.trim());
            if (extractedCells.length >= 13) {
                baseCells = extractedCells.slice(0, 13);
            }
        } catch (e) {
            console.warn("Could not load base overview; using blank fallbacks.", e);
        }

        // Default to empty strings if cells were not fully scraped
        while (baseCells.length < 13) baseCells.push("-");

        // --- STEP 2: SFHD List & Records (10 Columns) ---
        const sfhdDoc = await fetchDoc(urls.sfhd_list);
        const sfhdRows = Array.from(sfhdDoc.querySelectorAll(SELECTORS.sfhdListRows));
        const sfhdData = [];

        for (const row of sfhdRows) {
            const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
            const sfhdId = row.querySelector('.sfhd-id')?.innerText?.trim() || cells[0];
            if (!sfhdId) continue;

            const docs = await extractRecordDocs(urls.sfhd_record(sfhdId));
            sfhdData.push({
                detId: sfhdId,
                floodCertId: row.querySelector('.flood-cert-id')?.innerText?.trim() || cells[1] || '-',
                certBorrowerName: row.querySelector('.borrower-name')?.innerText?.trim() || cells[2] || '-',
                borrowerId: row.querySelector('.borrower-id')?.innerText?.trim() || cells[3] || '-',
                certLoanId: row.querySelector('.cert-loan-id')?.innerText?.trim() || cells[4] || '-',
                address: row.querySelector('.address')?.innerText?.trim() || cells[5] || '-',
                city: row.querySelector('.city')?.innerText?.trim() || cells[6] || '-',
                state: row.querySelector('.state')?.innerText?.trim() || cells[7] || '-',
                zip: row.querySelector('.zip')?.innerText?.trim() || cells[8] || '-',
                floodZone: row.querySelector('.flood-zone')?.innerText?.trim() || cells[9] || '-',
                addressSource: row.querySelector('.address-source')?.innerText?.trim() || '',
                docs: docs
            });
            await new Promise(r => setTimeout(r, 200)); // Guard against session rate limiting
        }

        // --- STEP 3: Collateral List & Records (12 Columns) ---
        const colDoc = await fetchDoc(urls.col_list);
        const colRows = Array.from(colDoc.querySelectorAll(SELECTORS.colListRows));
        const colData = [];

        for (const row of colRows) {
            const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
            const colId = row.querySelector('.col-id')?.innerText?.trim() || cells[0];
            if (!colId) continue;

            const docs = await extractRecordDocs(urls.col_record(colId));
            colData.push({
                colId: colId,
                name: row.querySelector('.col-name')?.innerText?.trim() || cells[1] || '-',
                type: row.querySelector('.col-type')?.innerText?.trim() || cells[2] || '-',
                subtype: row.querySelector('.col-subtype')?.innerText?.trim() || cells[3] || '-',
                address: row.querySelector('.col-address')?.innerText?.trim() || cells[4] || '-',
                city: row.querySelector('.col-city')?.innerText?.trim() || cells[5] || '-',
                state: row.querySelector('.col-state')?.innerText?.trim() || cells[6] || '-',
                zip: row.querySelector('.col-zip')?.innerText?.trim() || cells[7] || '-',
                countySubdiv: row.querySelector('.col-county')?.innerText?.trim() || cells[8] || '-',
                sec: row.querySelector('.col-sec')?.innerText?.trim() || cells[9] || '-',
                lot: row.querySelector('.col-lot')?.innerText?.trim() || cells[10] || '-',
                block: row.querySelector('.col-block')?.innerText?.trim() || cells[11] || '-',
                docs: docs
            });
            await new Promise(r => setTimeout(r, 200));
        }

        // --- STEP 4: Standalone Documents (Optional URL or Pooled Records) ---
        let generalDocs = [];
        try {
            const standaloneDocPage = await fetchDoc(urls.docs_list);
            const docRows = Array.from(standaloneDocPage.querySelectorAll(SELECTORS.standaloneDocRows));
            docRows.forEach(tr => {
                const docName = tr.children[0]?.innerText?.trim();
                const docId = tr.children[1]?.innerText?.trim();
                const note = tr.children[2]?.innerText?.trim() || '';
                if (docName && docId) generalDocs.push({ docName, docId, note });
            });
        } catch (e) {
            // Pool unique documents from Determinations & Collateral if standalone list is unavailable
            const seen = new Set();
            [...sfhdData, ...colData].forEach(rec => {
                rec.docs.forEach(d => {
                    if (!seen.has(d.docId)) {
                        seen.add(d.docId);
                        generalDocs.push(d);
                    }
                });
            });
        }

        // --- STEP 5: GENERATE WELLS FARGO PROFESSIONAL REPORT HTML ---
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

            <!-- 1. Event Overview (2 Rows x 13 Columns) -->
            <div style="margin-bottom: 22px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 6px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Event Overview
                    </h2>
                </div>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; font-size: 7.2pt; table-layout: fixed; word-break: break-word;">
                    <thead>
                        <tr style="background-color: #A6192E; color: #FFFFFF; text-align: center;">
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Mod Type</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Acct System</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Borrower Name</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Borrower ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Loan ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Product ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Synd/Part Type</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Product</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Commit Amt</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Prop Commit</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Cur Balance</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Loan Status</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Status Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="text-align: center; background-color: #FFFFFF;">
                            ${baseCells.map(c => `<td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(c)}</td>`).join('')}
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- 2. Determinations (Single Header, Repeated Rows + Horizontal Docs) -->
            <div style="margin-bottom: 22px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 6px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Determinations
                    </h2>
                </div>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; font-size: 7.5pt; table-layout: fixed; word-break: break-word;">
                    <thead>
                        <tr style="background-color: #A6192E; color: #FFFFFF; text-align: center;">
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Det ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Flood Cert ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Cert Borrower Name</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Borrower ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Cert Loan ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Address</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">City</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">State</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Zip</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Flood Zone</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sfhdData.map(item => `
                            <tr style="text-align: center; background-color: #FFFFFF;">
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px; font-weight: bold;">${escapeHtml(item.detId)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.floodCertId)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.certBorrowerName)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.borrowerId)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.certLoanId)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.address)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.city)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.state)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.zip)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px; font-weight: bold;">${escapeHtml(item.floodZone)}</td>
                            </tr>
                            <tr style="background-color: #FDFBF7;">
                                <td colspan="10" style="border: 1px solid #CCCCCC; padding: 6px 10px; border-left: 3px solid #F4A900;">
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

            <!-- 3. Collateral (Single Header, Repeated Rows + Horizontal Docs) -->
            <div style="margin-bottom: 22px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 6px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Collateral
                    </h2>
                </div>
                <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #CCCCCC; font-size: 7.2pt; table-layout: fixed; word-break: break-word;">
                    <thead>
                        <tr style="background-color: #A6192E; color: #FFFFFF; text-align: center;">
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Collat ID</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Name</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Type</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Sub-type</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Address</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">City</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">State</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Zip</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">County Subdiv</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Sec</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Lot</th>
                            <th style="border: 1px solid #B84353; padding: 5px 2px; font-weight: bold;">Block</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${colData.map(item => `
                            <tr style="text-align: center; background-color: #FFFFFF;">
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px; font-weight: bold;">${escapeHtml(item.colId)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.name)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.type)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.subtype)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.address)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.city)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.state)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.zip)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.countySubdiv)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.sec)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.lot)}</td>
                                <td style="border: 1px solid #CCCCCC; padding: 4px 2px;">${escapeHtml(item.block)}</td>
                            </tr>
                            <tr style="background-color: #FDFBF7;">
                                <td colspan="12" style="border: 1px solid #CCCCCC; padding: 6px 10px; border-left: 3px solid #F4A900;">
                                    ${renderDocumentGrid(item.docs)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- 4. Documents (Paragraph Elements) -->
            <div style="margin-bottom: 15px;">
                <div style="border-bottom: 2px solid #F4A900; padding-bottom: 3px; margin-bottom: 8px;">
                    <h2 style="mso-outline-level: 2; mso-style-name: 'Heading 2'; font-size: 11pt; font-weight: bold; color: #A6192E; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                        Documents
                    </h2>
                </div>
                <div style="font-size: 8.5pt; line-height: 1.4; padding-left: 2px;">
                    ${generalDocs.length > 0 ? generalDocs.map(d => `
                        <div style="margin-bottom: 8px;">
                            <p style="margin: 0; font-weight: bold; color: #222222;">${escapeHtml(d.docName)}:${escapeHtml(d.docId)}</p>
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

        // --- STEP 6: DOM-SELECTION COPY & FILE DOWNLOAD ---
        // 1. Native DOM selection copy (Preserves Office CF_HTML table descriptors)[cite: 2]
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
            console.warn("execCommand copy failed, falling back to Clipboard API...", e);
        }
        sel.removeAllRanges();
        document.body.removeChild(tempDiv);

        // Fallback to Clipboard API if execCommand wasn't allowed
        if (!copied && navigator.clipboard) {
            const blobHtml = new Blob([compiledHtml], { type: 'text/html' });
            const blobPlain = new Blob([compiledHtml], { type: 'text/plain' });
            await navigator.clipboard.write([
                new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobPlain })
            ]);
            copied = true;
        }

        if (copied) {
            console.log("Rich formatting copied to clipboard! You can paste directly into Word or OneNote.");
        }

        // 2. Trigger .doc file download for direct opening in Microsoft Word
        const docBlob = new Blob(['\ufeff', compiledHtml], { type: 'application/msword' });
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(docBlob);
        downloadLink.download = `QC_Report_Event_${eventId}.doc`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();

        console.log(`QC Report generation completed for Event ${eventId}.`);

    } catch (error) {
        console.error("Scraping workflow failed:", error);
    }
})();
