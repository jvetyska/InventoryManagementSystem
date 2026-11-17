CHANGESETNAME := $(shell date "+A%Y-%m-%d-%H-%M-%S")
CURRENT_ACCOUNT := $(shell aws iam list-account-aliases --query 'AccountAliases[0]' --output text)
ACCOUNT_dev = kmg-dosadev-dev
ACCOUNT_uat = kmg-dosauat-nonprod
ACCOUNT_test = kmg-dosauat-nonprod
ACCOUNT_svt = kmg-dosasvt-nonprod
ACCOUNT_prod = kmg-dosaprod-prod
ACCOUNT_shared = kmg-dosashared-meta
DESIRED_ACCOUNT = ${ACCOUNT_${ENVIRONMENT}}
_check-account:
ifneq ($(CURRENT_ACCOUNT), $(DESIRED_ACCOUNT))
	$(error Found: $(CURRENT_ACCOUNT) account for environment $(ENVIRONMENT). You are trying to run this from the wrong account)
endif

# Lint function to run for lambda from with HTML output
_cfn_lint:
	@mkdir -p outputs
	@echo "<html><body><pre>" > outputs/cfnlint-output.html
	@cfn-lint lambdas/environments/kmart-external/AP-SOUTHEAST-2/lambda.yaml --format parseable >> outputs/cfnlint-output.html
	@echo "</pre><h1>Excellent work! No issues found!</h1><img src='https://media.giphy.com/media/rT6bAA9A7A1Ne/giphy.gif'/></body></html>" >> outputs/cfnlint-output.html

lint:
	@echo "Running cfn-lint on lambda templates" && cfn-lint lambdas/environments/kmart-external/AP-SOUTHEAST-2/lambda.yaml && echo "All good!"

build-lambda: _check-account
	@./infra-deploy-lambda.sh -n dosa-$(ENVIRONMENT)-lambda	-f lambda -p lambda-$(ENVIRONMENT) -s kmart-dosa-$(ENVIRONMENT)-lambda-stack -i $(ENVIRONMENT)-dosa-kafka-lambda
