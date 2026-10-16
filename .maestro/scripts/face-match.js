// iOS lock flow: ask scripts/lock-ios.sh to post a simulated Face ID match (only when FACE_MATCH is set).
if (FACE_MATCH === '1') {
  http.get('http://127.0.0.1:8213/match');
}
