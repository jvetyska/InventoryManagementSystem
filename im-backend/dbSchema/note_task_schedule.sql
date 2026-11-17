CREATE TABLE `note_task_schedule` (
  `Type` varchar(50) NOT NULL,
  `IntervalMinutes` int DEFAULT NULL,
  `DateLastRun` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `DateNextRun` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
