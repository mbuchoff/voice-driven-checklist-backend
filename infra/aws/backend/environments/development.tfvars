environment = "development"
aws_region  = "us-east-1"

cognito_user_pool_id = "us-east-1_06KAQuIlH"
cognito_client_ids = [
  "17ms12o82p4qhah84jlb79jk50",
  "4vidcgncjotgc3eaf7spoafutr",
]

mongodb_uri      = "mongodb+srv://voicechecklist.0hbva2h.mongodb.net/"
mongodb_database = "voice_checklist_dev"

powersync_endpoint   = "https://6aaef0eb02481fb31b97e80b.powersync.journeyapps.com"
powersync_jwt_issuer = "https://github.com/mbuchoff/voice-driven-checklist-backend/deployments/development"
powersync_jwt_key_id = "development-1"

runtime_secret_parameter_name = "/voice-checklist/development/runtime"

cors_allowed_origins = [
  "http://127.0.0.1:4014",
  "http://127.0.0.1:8081",
  "http://localhost:4014",
  "http://localhost:8081",
]
