Pod::Spec.new do |s|
  s.name           = 'BackupFolder'
  s.version        = '1.0.0'
  s.summary        = 'Native PBKDF2 and window privacy for Mood backups'
  s.description    = 'CommonCrypto PBKDF2-HMAC-SHA256 (backup password); folder access arrives with automatic backup.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
