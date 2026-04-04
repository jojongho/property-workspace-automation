@echo off
chcp 65001 > nul
color 0A
cls

echo.
echo ========================================
echo   네이버부동산 순위조회 프로그램
echo ========================================
echo.
echo 첫 실행 시 브라우저 설치가 필요합니다.
echo.
echo - 설치 용량: 약 300MB
echo - 소요 시간: 1-2분 (인터넷 속도에 따라 다름)
echo - 한 번만 설치하면 됩니다
echo.
echo ========================================
echo.
pause

cd /d "%~dp0"

REM 브라우저 설치 프로그램 실행
if exist "%~dp0브라우저_설치.exe" (
    echo [1/2] Playwright 브라우저 설치 중...
    echo.
    call "%~dp0브라우저_설치.exe"
) else (
    echo.
    echo [1/2] Playwright 브라우저 설치 중...
    echo.
    echo 브라우저_설치.exe 파일이 없습니다.
    echo 대체 방법으로 설치를 시도합니다...
    echo.
    python -m playwright install chromium 2>&1
    if %ERRORLEVEL% NEQ 0 (
        py -m playwright install chromium 2>&1
    )
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ========================================
    echo   오류: 브라우저 설치 실패
    echo ========================================
    echo.
    echo 다음을 확인해주세요:
    echo 1. 인터넷 연결 상태
    echo 2. 방화벽 설정
    echo 3. 디스크 여유 공간 (최소 500MB)
    echo.
    echo 문제가 지속되면 관리자에게 문의하세요.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   브라우저 설치 완료!
echo ========================================
echo.
echo [2/2] 프로그램을 시작합니다...
echo.
timeout /t 2 > nul

cd /d "%~dp0"
start "" "%~dp0네이버부동산_순위조회.exe"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo 오류: 프로그램 실행 실패
    echo exe 파일이 같은 폴더에 있는지 확인하세요.
    pause
    exit /b 1
)

echo.
echo 프로그램이 실행되었습니다.
echo 이 창을 닫아도 됩니다.
echo.
timeout /t 3 > nul
exit
