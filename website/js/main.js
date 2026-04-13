document.addEventListener('DOMContentLoaded', () => {
    // 1. Navbar Scroll Effect
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('nav-scrolled');
        } else {
            navbar.classList.remove('nav-scrolled');
        }
    });

    // 2. OS Detection for Dynamic Download Button
    const heroBtn = document.getElementById('hero-download-btn');
    const heroIcon = document.getElementById('hero-os-icon');
    const heroText = document.getElementById('hero-os-text');
    const heroHint = document.getElementById('hero-os-hint');

    const platform = navigator.userAgent.toLowerCase();
    
    // Auto-detect OS and update the main CTA button
    if (platform.includes('mac')) {
        heroBtn.href = './download/DesktopPet-Mac.dmg';
        heroIcon.className = 'fa-brands fa-apple text-2xl';
        heroText.innerText = '下载 macOS 版';
        heroHint.innerText = '已为您自动推荐 macOS 适配版本 (10.15+)';
    } else if (platform.includes('win')) {
        heroBtn.href = './download/DesktopPet-Win.exe';
        heroIcon.className = 'fa-brands fa-windows text-2xl';
        heroText.innerText = '下载 Windows 版';
        heroHint.innerText = '已为您自动推荐 Windows 适配版本 (Win10/11 64位)';
    } else if (platform.includes('linux')) {
        heroBtn.href = '#download'; // Linux currently not officially supported, redirect to section
        heroIcon.className = 'fa-brands fa-linux text-2xl';
        heroText.innerText = '查看下载选项';
        heroHint.innerText = '抱歉，暂未提供 Linux 正式版，请查看其他选项';
    } else {
        // Fallback for mobile or unknown
        heroBtn.href = '#download';
        heroIcon.className = 'fa-solid fa-download text-2xl';
        heroText.innerText = '查看下载选项';
        heroHint.innerText = '请在桌面端浏览器下载安装体验';
    }

    // 3. Smooth scrolling for anchor links (fallback for browsers not supporting CSS scroll-behavior)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if(targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });
});
