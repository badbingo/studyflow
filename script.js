// 语言切换功能
let currentLanguage = 'en';

function toggleLanguage() {
    currentLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
    updateLanguage();
    updateButtonText();
}

function updateLanguage() {
    const elements = document.querySelectorAll('[data-en]');
    elements.forEach(element => {
        if (currentLanguage === 'en') {
            // 显示英文内容
            element.textContent = element.getAttribute('data-en');
        } else {
            // 显示中文内容 - 如果有data-zh属性就用它，否则用原始内容
            const zhContent = element.getAttribute('data-zh') || element.textContent;
            element.textContent = zhContent;
        }
    });
}

function updateButtonText() {
    const button = document.querySelector('.language-switch');
    if (currentLanguage === 'en') {
        button.textContent = '中文';
    } else {
        button.textContent = 'EN';
    }
}

// 平滑滚动功能
function scrollToSection(sectionId) {
    const element = document.getElementById(sectionId);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

function scrollToDownload() {
    scrollToSection('download');
}

function scrollToFeatures() {
    scrollToSection('features');
}

// 导航栏滚动效果
let lastScrollY = window.scrollY;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;
    
    if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // 向下滚动，隐藏导航栏
        navbar.style.transform = 'translateY(-100%)';
    } else {
        // 向上滚动或顶部，显示导航栏
        navbar.style.transform = 'translateY(0)';
    }
    
    lastScrollY = currentScrollY;
});

// 动画效果 - 滚动显示
function initAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // 观察需要动画的元素
    const animatedElements = document.querySelectorAll('.feature-card, .comparison-table, .download-btn');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// 应用商店按钮点击效果
document.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        
        // 添加点击动画效果
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = '';
        }, 150);
        
        // 显示下载提示（实际项目中应链接到应用商店）
        alert(currentLanguage === 'en' ? 
            'Redirecting to app store download page' : 
            '即将跳转到应用商店下载页面');
    });
});

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 初始化语言 - 默认显示英文
    updateLanguage();
    updateButtonText();
    
    // 初始化动画
    initAnimations();
    
    // 添加鼠标悬停效果到功能卡片
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.querySelector('.feature-icon').style.transform = 'scale(1.1)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.querySelector('.feature-icon').style.transform = 'scale(1)';
        });
    });
    
    // 控制台欢迎信息
    console.log('%c📚 Studyflow - Smart Learning Management App', 
        'color: #2563eb; font-size: 18px; font-weight: bold;');
    console.log('%cWelcome to the Studyflow official website!', 
        'color: #64748b; font-size: 14px;');
});

// 性能优化 - 图片懒加载
if ('IntersectionObserver' in window) {
    const lazyImages = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    lazyImages.forEach(img => {
        imageObserver.observe(img);
    });
}

// 错误处理
window.addEventListener('error', function(e) {
    console.error('页面错误:', e.error);
});

// 键盘导航支持
document.addEventListener('keydown', function(e) {
    // ESC键关闭所有模态框（如果有）
    if (e.key === 'Escape') {
        console.log('ESC pressed - closing modals');
    }
    
    // 空格键滚动
    if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        window.scrollBy(0, window.innerHeight * 0.8);
    }
});

// 移动端触摸优化
let touchStartY = 0;

document.addEventListener('touchstart', function(e) {
    touchStartY = e.touches[0].clientY;
});

document.addEventListener('touchend', function(e) {
    const touchEndY = e.changedTouches[0].clientY;
    const diffY = touchEndY - touchStartY;
    
    // 快速下滑刷新页面
    if (diffY > 100 && window.scrollY === 0) {
        window.location.reload();
    }
});