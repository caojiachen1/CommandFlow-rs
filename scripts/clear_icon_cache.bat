@echo off
taskkill /f /im explorer.exe
CD /d %userprofile%\AppData\Local
if exist IconCache.db del /a /f IconCache.db
CD /d %userprofile%\AppData\Local\Microsoft\Windows\Explorer
del /a /f iconcache_*.db 2>nul
start explorer.exe
echo Icon cache cleared and rebuilt successfully。