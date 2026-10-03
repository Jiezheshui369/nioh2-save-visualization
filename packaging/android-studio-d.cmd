@echo off
setlocal
set "ANDROID_HOME=D:\Android\sdk"
set "ANDROID_USER_HOME=D:\Android\user"
set "ANDROID_AVD_HOME=D:\Android\avd"
set "GRADLE_USER_HOME=D:\Android\gradle-cache"
set "STUDIO_PROPERTIES=D:\Android\studio.properties"
set "STUDIO_JDK=D:\Android\android-studio\jbr"
set "STUDIO_GRADLE_JDK=D:\Android\jdk-21"
set "JAVA_HOME=D:\Android\jdk-21"
set "TEMP=D:\Android\temp"
set "TMP=D:\Android\temp"
set "JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS% -Djava.io.tmpdir=D:\Android\temp -Djdk.net.unixdomain.tmpdir=D:\Android\temp"
start "" "D:\Android\android-studio\bin\studio64.exe" %*
endlocal
