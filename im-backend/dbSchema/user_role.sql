CREATE TABLE `user_role` (
  `RoleName` varchar(50) NOT NULL,
  `RoleLevel` enum('admin','rm','manager','associate','guest') DEFAULT NULL,
  `RoleArea` enum('WRH','STR') DEFAULT NULL,
  PRIMARY KEY (`RoleName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
