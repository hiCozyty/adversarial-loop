### .env example for redTeam

CALDERA_URL=http://10.1.99.1:8888

CALDERA_KEY=ADMIN123

curl -s -H "KEY:ADMIN123" http://10.1.99.1:8888/api/v2/adversaries | jq '.[] | select(.name == "your_adversary_name") | .adversary_id'

ADVERSARY_ID=populate with your custom adversary profile ID

TARGET_HOST=debian #host name of the target vm machine

LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=


WAZUH_URL=https://10.1.99.22:55000
WAZUH_USER=wazuh
WAZUH_PASS=REPLACE_ME

THEHIVE_URL=http://10.1.99.22:9000
THEHIVE_API_KEY=REPLACE_ME

GITHUB_TOKEN=REPLACE_ME
GITHUB_REPO=your-org/adversarial-loop