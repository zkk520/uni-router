package conf

import (
	"os"
)

func IsDebug() bool {
	return os.Getenv(APP_ENV_PREFIX+"_DEBUG") == "true"
}
