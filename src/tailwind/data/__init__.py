"""Warehouse-agnostic data access layer."""

from tailwind.data.base import Query, QueryResult, WarehouseClient
from tailwind.data.registry import get_warehouse

__all__ = ["Query", "QueryResult", "WarehouseClient", "get_warehouse"]
