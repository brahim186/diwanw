// دالة للبحث واستبدال النص في جميع عناصر الصفحة دون التأثير على الأكواد التأسيسية
function replaceNameInPage(RIHANIO, Rihanio) {
    const walk = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let node;
    while (node = walk.nextNode()) {
        node.nodeValue = node.nodeValue.replace(new RegExp(oldName, 'g'), newName);
    }
}

// تشغيل الدالة بمجرد تحميل الصفحة بالكامل
window.addEventListener('DOMContentLoaded', () => {
    replaceNameInPage('RIHANIO', 'Rihanio');
});
