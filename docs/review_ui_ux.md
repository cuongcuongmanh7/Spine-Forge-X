# SpineForge X - UIUX Redesign Final Specification

## Overview

Mục tiêu

 Giảm cognitive load
 Tăng tốc độ scan asset
 Giảm số bước khi Cleanup
 Thống nhất workflow Inventory → Reports
 Loại bỏ UI trùng lặp và các bước chọn scope dư thừa

---

# Navigation Structure

## Top Navigation

```text
Inventory
Reports
```

### Inventory

Quản lý asset.

Bao gồm

 Search
 Filters
 Asset Grid
 Asset Preview
 Multi Select Actions

---

### Reports

Phân tích dữ liệu.

Bao gồm

 Unused Assets
 Missing Attachments
 Duplicate Atlases
 Version Mismatch
 Oversized Assets

Reports KHÔNG phải là nơi chọn scope.

Reports chỉ hiển thị kết quả phân tích.

---

# Sidebar Structure

## Library

```text
Projects

[BD] - Visual       349 files

[FD] - Animation    278 files
```

Requirements

 Hiển thị số file Spine bên cạnh project
 Project đang chọn phải có

   Background highlight
   Border accent
   Selected state rõ ràng

Ví dụ

```text
[FD] - Animation   278 files
```

được highlight.

---

KHÔNG hiển thị

```text
Favorites
Recent
```

---

# Inventory Tab

## Statistics Cards

Hiển thị

```text
Total Assets
Spine Files
Image Size
Not Scanned
Clean
Needs Review
```

Layout card giống dashboard.

Không dùng badge nhỏ.

---

## Filters

Inventory là nơi định nghĩa scope.

Ví dụ

```text
Type = Enemy

Status = Needs Review

Tag = Boss

Search = boss
```

Kết quả

```text
58 assets matched
```

Scope này sẽ được dùng cho Reports.

---

# Asset Card

## Thumbnail First

Card ưu tiên hình ảnh.

Metadata tối giản.

Hiển thị

```text
Thumbnail

File Name

Animation Count

Size

Owner

Date
```

---

## Selection

Checkbox

Top Left

Status Badge

Top Right

Không chồng lên nhau.

---

## Selected State

Asset được chọn

 Blue Border
 Glow nhẹ
 Checkbox checked

---

# Inventory - Single Select

## Trigger

User chọn 1 asset.

---

## Right Panel

Hiển thị

```text
Animation Preview

Animations

Skins

Metadata

Warnings
```

---

Ví dụ Metadata

```text
Version
Size
Atlas
Animations
Skins
Owner
Modified Date
```

---

Không hiển thị

 Scope Summary
 Cleanup Information

---

# Inventory - Multi Select

## Trigger

Selected Count  1

---

## Right Panel

Không preview animation.

Hiển thị

```text
Selected Assets Summary
```

---

Section

### Scope Summary

```text
Project

Type

Status

Tags

Search

Matched Assets
```

---

### Impact Estimate

```text
Potential Cleanup Size

Files Affected
```

---

### Actions

```text
Validate

Export

Move

View In Reports
```

---

Inventory không thực hiện cleanup.

Inventory chỉ chuyển sang Reports.

---

# Reports Tab

Reports lấy Scope từ Inventory.

KHÔNG có

 Folder Picker
 Folder Tree
 Scan Scope Selector

---

## Sidebar

```text
Unused Assets

Missing Attachments

Duplicate Atlases

Version Mismatch

Oversized Assets
```

---

# Reports - Unused Assets

## Header

Hiển thị Scope

```text
Project

Type

Status

Tags

Search

Matched Assets
```

Ví dụ

```text
Project [FD] Animation

Type Enemy

Status Needs Review

Tag Boss

Matched 58
```

---

## Dashboard Cards

```text
Unused Assets

Can Be Cleaned

Atlases Affected

Safe To Clean
```

Ví dụ

```text
16 Assets

3.2 MB

3 Atlases

Safe
```

---

## Main Table

Columns

```text
Checkbox

Thumbnail

Name

Type

Size

Atlas

Path

Modified Date
```

---

Grouping

Optional

```text
Group by Atlas
```

---

# Reports - Cleanup Review

## Right Panel

Hiển thị

```text
Cleanup Summary
```

---

Thông tin

```text
Unused Assets

Total Size

Atlases Affected

Destination Folder
```

---

## Warning Block

```text
This action cannot be undone.
```

hoặc

```text
Files will be moved to backup folder.
```

---

## Action Button

```text
Clean & Move To _unused_backup
```

Primary Danger Action.

---

# Workflow

## Single Asset

```text
Inventory

Select Asset

Preview Asset
```

---

## Multi Asset

```text
Inventory

Select Multiple

Review Scope

View In Reports
```

---

## Cleanup

```text
Inventory Filters

↓

Reports

↓

Unused Assets

↓

Review

↓

Clean & Move To Backup
```

---

# Removed Features

Loại bỏ hoàn toàn

```text
Folder Picker
```

```text
Manual Scan Scope
```

```text
Favorites
```

```text
Recent
```

```text
Cleanup Tab Old Design
```

```text
Folder Tree Cleanup UI
```

---

# Design Direction

Reference

 Linear
 Raycast
 GitHub Desktop
 Unity Package Manager
 Figma

Theme

Dark Professional

Accent

#3B82F6

Success

#22C55E

Warning

#F59E0B

Error

#EF4444

Radius

10-12px

Grid

8px spacing system

```
```
