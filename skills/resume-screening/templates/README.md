# 岗位模板目录

此目录用于存储岗位要求模板（YAML 格式）。

## 模板格式

```yaml
id: java-developer
name: Java 开发工程师
requiredSkills:
  - Java
  - Spring Boot
  - MySQL
bonusSkills:
  - Redis
  - Kafka
  - 微服务架构
experienceYears: 3+
education: 本科及以上
otherRequirements:
  - 有互联网项目经验优先
```

## 使用方式

- 将 YAML 文件放入此目录
- 文件名将作为模板 ID（不含扩展名）
- 通过 `listTemplates()` 查看所有可用模板
- 通过 `loadTemplate(id)` 加载特定模板