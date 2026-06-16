# Security Policy

## Supported Versions

Only the latest released version of SpineForge X receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in SpineForge X, report it privately by
email to **cuongdm@ondigames.com**.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a proof of concept if possible).
- The version of SpineForge X affected and your operating system.

You can expect an initial response within **7 days**. Once the issue is
confirmed, a fix will be released as soon as practical and you will be credited
unless you prefer to remain anonymous.

## Scope

SpineForge X is a desktop application that wraps the Spine command-line editor.
It runs with the privileges of the local user and reads/writes files in folders
the user explicitly selects. Reports about the following are in scope:

- Arbitrary code execution or privilege escalation.
- Reading or writing files outside user-selected folders.
- Tampering with the auto-updater or its signature verification.

Out of scope: vulnerabilities in the Spine editor itself (report those to
Esoteric Software) and issues that require the attacker to already have full
control of the user's machine.
