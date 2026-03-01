package main

import rego.v1

default allow := true

deny contains msg if {
  not valid_branch
  msg := sprintf("Branch naming policy ihlali: %s", [input.context.branch])
}

valid_branch if input.context.branch == "main"

valid_branch if input.context.branch == "pre-prod"

valid_branch if {
  regex.match("^daf-[0-9]+-[a-z0-9-]+$", input.context.branch)
}

socket_contract_changed if {
  some i
  startswith(input.changedFiles[i], "packages/socket-contracts/src/")
}

socket_contract_changed if {
  some i
  startswith(input.changedFiles[i], "packages/socket-contracts/test/")
}

socket_contract_changed if {
  some i
  input.changedFiles[i] == "packages/socket-contracts/package.json"
}

socket_contract_version_bumped if {
  some i
  input.changedFiles[i] == "packages/socket-contracts/package.json"
}

deny contains msg if {
  socket_contract_changed
  not socket_contract_version_bumped
  msg := "Socket contract degisti ancak packages/socket-contracts/package.json degismedi."
}
