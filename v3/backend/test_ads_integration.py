#!/usr/bin/env python3
"""
광고 플랫폼 연동 종합 테스트 스크립트
Google Ads, Meta Ads, Naver Ads 연동 상태 점검
"""

import os
import sys
import json
from datetime import datetime
from typing import Dict, List, Any

class AdsIntegrationTester:
    def __init__(self):
        self.test_results = {
            "timestamp": datetime.now().isoformat(),
            "platforms": {
                "google_ads": {},
                "meta_ads": {},
                "naver_ads": {}
            }
        }

    def test_google_ads(self) -> Dict[str, Any]:
        """Google Ads API 연동 테스트"""
        results = {
            "status": "NOT_IMPLEMENTED",
            "file_exists": False,
            "client_exists": False,
            "tests": []
        }

        # 파일 존재 확인
        google_ads_file = "google_ads_client.py"
        sync_file = "pipelines/sync_google_ads.py"

        if os.path.exists(google_ads_file):
            results["file_exists"] = True
            try:
                from google_ads_client import GoogleAdsAPIClient
                results["client_exists"] = True

                # 기본 연결 테스트
                results["tests"].append({
                    "name": "API Connection",
                    "status": "PENDING",
                    "message": "Google Ads API v15 연결 테스트 필요"
                })

                # CRUD 테스트
                results["tests"].append({
                    "name": "Campaign CRUD",
                    "status": "PENDING",
                    "message": "캠페인/광고그룹/광고 CRUD 작업 테스트 필요"
                })

                results["status"] = "READY_FOR_TESTING"
            except ImportError as e:
                results["error"] = str(e)
                results["status"] = "IMPORT_ERROR"
        else:
            results["message"] = f"{google_ads_file} 파일이 존재하지 않음"
            results["required_implementation"] = [
                "GoogleAdsAPIClient 클래스 구현",
                "OAuth2 인증 플로우",
                "캠페인/광고그룹/광고 CRUD 메소드",
                "성과 데이터 수집 메소드",
                "BigQuery 동기화 로직"
            ]

        return results

    def test_meta_ads(self) -> Dict[str, Any]:
        """Meta(Facebook/Instagram) Ads API 연동 테스트"""
        results = {
            "status": "NOT_IMPLEMENTED",
            "file_exists": False,
            "client_exists": False,
            "tests": []
        }

        # 파일 존재 확인
        meta_ads_file = "meta_ads_client.py"
        sync_file = "pipelines/sync_meta_ads.py"

        if os.path.exists(meta_ads_file):
            results["file_exists"] = True
            try:
                from meta_ads_client import MetaAdsAPIClient
                results["client_exists"] = True

                # 기본 연결 테스트
                results["tests"].append({
                    "name": "API Connection",
                    "status": "PENDING",
                    "message": "Meta Business API v19.0 연결 테스트 필요"
                })

                # 권한 테스트
                results["tests"].append({
                    "name": "Permissions Check",
                    "status": "PENDING",
                    "message": "Facebook Login 및 권한 획득 테스트 필요"
                })

                results["status"] = "READY_FOR_TESTING"
            except ImportError as e:
                results["error"] = str(e)
                results["status"] = "IMPORT_ERROR"
        else:
            results["message"] = f"{meta_ads_file} 파일이 존재하지 않음"
            results["required_implementation"] = [
                "MetaAdsAPIClient 클래스 구현",
                "Facebook Login OAuth2 인증",
                "광고 계정 연결 메소드",
                "캠페인/광고세트/광고 CRUD 메소드",
                "Insights API 데이터 수집",
                "BigQuery 동기화 로직"
            ]

        return results

    def test_naver_ads(self) -> Dict[str, Any]:
        """Naver 검색광고 API 연동 테스트"""
        results = {
            "status": "NOT_IMPLEMENTED",
            "file_exists": False,
            "client_exists": False,
            "tests": []
        }

        # 파일 존재 확인
        naver_ads_file = "naver_ads.py"
        sync_file = "pipelines/sync_naver_ads.py"

        if os.path.exists(naver_ads_file):
            results["file_exists"] = True
            try:
                from naver_ads import NaverAdsAPIClient
                results["client_exists"] = True

                # 기본 연결 테스트
                results["tests"].append({
                    "name": "API Connection",
                    "status": "PENDING",
                    "message": "Naver 검색광고 API 연결 테스트 필요"
                })

                # 토큰 갱신 테스트
                results["tests"].append({
                    "name": "Token Refresh",
                    "status": "PENDING",
                    "message": "API 토큰 갱신 메커니즘 테스트 필요"
                })

                results["status"] = "READY_FOR_TESTING"
            except ImportError as e:
                results["error"] = str(e)
                results["status"] = "IMPORT_ERROR"
        else:
            results["message"] = f"{naver_ads_file} 파일이 존재하지 않음"
            results["required_implementation"] = [
                "NaverAdsAPIClient 클래스 구현",
                "API 인증 및 토큰 관리",
                "캠페인/광고그룹/키워드 CRUD 메소드",
                "보고서 및 통계 데이터 수집",
                "BigQuery 동기화 로직"
            ]

        return results

    def check_bigquery_setup(self) -> Dict[str, Any]:
        """BigQuery 설정 확인"""
        results = {
            "schemas_exist": False,
            "connection_ready": False
        }

        if os.path.exists("bigquery_schemas"):
            results["schemas_exist"] = True
            schemas = os.listdir("bigquery_schemas")
            results["available_schemas"] = schemas

        return results

    def run_all_tests(self):
        """모든 플랫폼 테스트 실행"""
        print("=" * 60)
        print("광고 플랫폼 연동 종합 테스트")
        print("=" * 60)

        # Google Ads 테스트
        print("\n[1] Google Ads API 테스트")
        print("-" * 40)
        google_results = self.test_google_ads()
        self.test_results["platforms"]["google_ads"] = google_results
        print(f"상태: {google_results['status']}")
        if "message" in google_results:
            print(f"메시지: {google_results['message']}")

        # Meta Ads 테스트
        print("\n[2] Meta(Facebook/Instagram) Ads API 테스트")
        print("-" * 40)
        meta_results = self.test_meta_ads()
        self.test_results["platforms"]["meta_ads"] = meta_results
        print(f"상태: {meta_results['status']}")
        if "message" in meta_results:
            print(f"메시지: {meta_results['message']}")

        # Naver Ads 테스트
        print("\n[3] Naver 검색광고 API 테스트")
        print("-" * 40)
        naver_results = self.test_naver_ads()
        self.test_results["platforms"]["naver_ads"] = naver_results
        print(f"상태: {naver_results['status']}")
        if "message" in naver_results:
            print(f"메시지: {naver_results['message']}")

        # BigQuery 설정 확인
        print("\n[4] BigQuery 설정 확인")
        print("-" * 40)
        bq_results = self.check_bigquery_setup()
        self.test_results["bigquery"] = bq_results
        print(f"스키마 존재: {bq_results['schemas_exist']}")
        if "available_schemas" in bq_results:
            print(f"사용 가능한 스키마: {bq_results['available_schemas']}")

        # 결과 저장
        self.save_results()

        return self.test_results

    def save_results(self):
        """테스트 결과를 JSON 파일로 저장"""
        filename = f"test_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(self.test_results, f, indent=2, ensure_ascii=False)
        print(f"\n테스트 결과가 {filename}에 저장되었습니다.")

if __name__ == "__main__":
    tester = AdsIntegrationTester()
    results = tester.run_all_tests()

    # 종합 결과 출력
    print("\n" + "=" * 60)
    print("종합 테스트 결과")
    print("=" * 60)

    all_platforms = ["google_ads", "meta_ads", "naver_ads"]
    implemented_count = 0

    for platform in all_platforms:
        status = results["platforms"][platform]["status"]
        if status != "NOT_IMPLEMENTED":
            implemented_count += 1

    print(f"구현된 플랫폼: {implemented_count}/{len(all_platforms)}")

    if implemented_count == 0:
        print("\n⚠️  경고: 모든 광고 플랫폼 연동이 구현되지 않았습니다.")
        print("테스트를 수행하려면 먼저 다음 파일들을 구현해야 합니다:")
        print("- backend/google_ads_client.py")
        print("- backend/meta_ads_client.py")
        print("- backend/naver_ads.py")
        print("- backend/pipelines/sync_google_ads.py")
        print("- backend/pipelines/sync_meta_ads.py")
        print("- backend/pipelines/sync_naver_ads.py")