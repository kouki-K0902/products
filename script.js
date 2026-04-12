let pyodide;
    let editorPlant, editorAnalyze;
    let hasHarvested = false;

    async function setup() {
        pyodide = await loadPyodide();
        await pyodide.loadPackage(["numpy", "matplotlib"]);
        
        await pyodide.runPythonAsync(`
import numpy as np
import matplotlib
matplotlib.use('Agg') # インタラクティブなツールバーを無効化
import matplotlib.pyplot as plt
import io, base64, sys, csv

class Plot:
    def __init__(self, x, y, is_sunny, is_water):
        self.x, self.y = x, y
        self.is_sunny, self.is_water = is_sunny, is_water
        self.variety = None
        self.yield_val = 0.0

farm = [[Plot(x, y, y < 4, x < 2) for x in range(8)] for y in range(8)]

def internal_calc_yield(p):
    if not p.variety: return 0.0
    res = 50.0 + {'A': 10, 'B': 25, 'C': 5}[p.variety]
    if p.variety == 'B':
        if p.is_water: res -= 40
        if p.is_sunny: res += 10
    return round(max(0, res + np.random.normal(0, 5)), 1)

def generate_csv():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['index', 'variety', 'is_sunny', 'is_water', 'yield'])
    idx = 0
    for row in farm:
        for p in row:
            writer.writerow([idx, p.variety, p.is_sunny, p.is_water, p.yield_val])
            idx += 1
    return output.getvalue()
        `);

        const editorConfig = { mode: "python", theme: "dracula", lineNumbers: true, indentUnit: 4 };
        editorPlant = CodeMirror.fromTextArea(document.getElementById('code-plant'), editorConfig);
        editorAnalyze = CodeMirror.fromTextArea(document.getElementById('code-analyze'), editorConfig);

        document.getElementById('console').innerText = "✅ Ready";
        document.getElementById('plant-btn').disabled = false;
        initGrid();
    }

    function switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        
        document.getElementById('editor-plant-box').classList.toggle('hidden', tab !== 'plant');
        document.getElementById('editor-analyze-box').classList.toggle('hidden', tab !== 'analyze');
        
        document.getElementById('plant-btn').classList.toggle('hidden', tab !== 'plant');
        document.getElementById('harvest-btn').classList.toggle('hidden', tab !== 'plant');
        document.getElementById('analyze-btn').classList.toggle('hidden', tab !== 'analyze');
        
        // CSV保存ボタン：実験計画タブかつ収穫済みの場合のみ表示
        const csvBtn = document.getElementById('csv-btn');
        if (tab === 'plant' && hasHarvested === true) {
            csvBtn.classList.remove('hidden');
        } else {
            csvBtn.classList.add('hidden');
        }

        if(tab === 'plant') editorPlant.refresh(); else editorAnalyze.refresh();
    }

    function updateCellUI(y, x, variety, yieldVal) {
        const cell = document.getElementById(`cell-${y}-${x}`);
        const pos = (y < 3) ? 'bottom' : 'top';
        const tooltipHtml = `<b>farm[${y}][${x}]</b><br>• is_sunny: ${y < 4 ? '☀️' : '☁️'}<br>• is_water: ${x < 2 ? '💧' : '🏞️'}<br>• variety: ${variety || '-'}<br>• yield_val: ${yieldVal || '-'}`;
        cell.innerHTML = `<span>${variety || ''}</span>${yieldVal ? `<span class="yield-val">${yieldVal}</span>` : ''}<div class="tooltip ${pos}">${tooltipHtml}</div>`;
    }

    function initGrid() {
        const grid = document.getElementById('farm-grid');
        grid.innerHTML = '';
        for(let i=0; i<64; i++) {
            const y = Math.floor(i/8), x = i%8;
            const div = document.createElement('div');
            div.id = `cell-${y}-${x}`;
            div.className = `cell ${y<4?'sunny':'shady'} ${x<2?'water-edge':''}`;
            grid.appendChild(div);
            updateCellUI(y, x, null, null);
        }
    }

    async function executePlanting() {
        try {
            await pyodide.runPythonAsync(editorPlant.getValue());
            for(let y=0; y<8; y++) for(let x=0; x<8; x++) updateCellUI(y, x, pyodide.runPython(`farm[${y}][${x}].variety`), null);
            document.getElementById('harvest-btn').disabled = false;
            log("植え付け完了。");
        } catch (e) { log("Error: " + e); }
    }

    async function executeHarvest() {
        try {
            pyodide.runPython(`for row in farm:
    for p in row: p.yield_val = internal_calc_yield(p)`);
            for(let y=0; y<8; y++) for(let x=0; x<8; x++) updateCellUI(y, x, pyodide.runPython(`farm[${y}][${x}].variety`), pyodide.runPython(`farm[${y}][${x}].yield_val`));
            hasHarvested = true;
            document.getElementById('csv-btn').classList.remove('hidden');
            log("収穫完了！「実験計画」タブのCSV保存ボタンが有効になりました。");
        } catch (e) { log("Error: " + e); }
    }

    async function executeAnalysis() {
        log("分析実行中...");
        // 出力バッファの初期化
        pyodide.runPython(`sys.stdout = io.StringIO()`);
        
        try {
            // plt.show() がエラーを出さないように、一時的にダミー関数に置き換える
            await pyodide.runPythonAsync(`
import matplotlib.pyplot as plt
def dummy_show(): pass
original_show = plt.show
plt.show = dummy_show
            `);

            // ユーザーコードの実行
            await pyodide.runPythonAsync(editorAnalyze.getValue());

            // グラフが存在するか確認して画像化
            const imgStr = pyodide.runPython(`
import base64
img_data = ""
if plt.get_fignums():
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close('all')
    img_data = base64.b64encode(buf.getvalue()).decode('utf-8')
# plt.show を元に戻す
plt.show = original_show
img_data
            `);

            if(imgStr) {
                const plotArea = document.getElementById('plot-area');
                const item = document.createElement('div');
                item.className = 'plot-item';
                
                // 独自の削除・保存ボタンを作成
                item.innerHTML = `
                    <div class="plot-actions">
                        <button class="plot-btn-del" onclick="this.parentElement.parentElement.remove()">このグラフを削除</button>
                        <button class="plot-btn-save" onclick="const a=document.createElement('a');a.href='data:image/png;base64,${imgStr}';a.download='plot.png';a.click();">PNGとして保存</button>
                    </div>
                    <img src="data:image/png;base64,${imgStr}">
                `;
                plotArea.appendChild(item);
                item.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }

            // コンソール出力の表示
            log(pyodide.runPython("sys.stdout.getvalue()") || "分析完了");

        } catch (e) { 
            log("❌ 分析エラー:\n" + e); 
            // エラー時も show を元に戻しておく
            pyodide.runPython(`import matplotlib.pyplot as plt; plt.show = getattr(plt, 'original_show', plt.show)`);
        }
    }
    function downloadCSV() {
        const csvContent = pyodide.runPython("generate_csv()");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "fisher_farm_data.csv";
        link.click();
    }

    function log(m) { document.getElementById('console').innerText = m; }
    setup();