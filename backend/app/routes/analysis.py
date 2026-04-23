from math import sqrt
from datetime import timedelta, date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Account, Post, PostAnalysis, CoordinatedGroup, Alert
from backend.app.services import ml_service
from packages.shared_contracts.analysis_contract import LABEL_ORDER


router = APIRouter()


@router.post("/analyze")
def analyze(body: dict, db: Session = Depends(get_db)):
    post_id = body.get("post_id")
    raw_text = body.get("raw_text")
    save = body.get("save")
    force = body.get("force")

    if post_id is None and raw_text is None:
        raise HTTPException(
            status_code=400,
            detail="either post_id or raw_text is required",
        )

    model_version = "tfidf_lr_v1"

    if post_id is not None:
        if save is None:
            save = True
        if force is None:
            force = False

        post = db.query(Post).filter(Post.id == post_id).first()

        if post is None:
            raise HTTPException(status_code=404, detail="Post not found")

        if post.raw_text is None or post.raw_text == "":
            raise HTTPException(status_code=400, detail="Post has no raw_text")

        existing = (
            db.query(PostAnalysis)
            .filter(PostAnalysis.post_id == post.id)
            .filter(PostAnalysis.model_version == model_version)
            .first()
        )

        if existing is not None and not force:
            return {
                "status": "ok",
                "stored": False,
                "clean_text": existing.clean_text,
                "predicted_label": existing.predicted_label,
                "confidence": existing.confidence,
                "topic_vector": existing.topic_vector,
                "model_version": existing.model_version,
            }

        analysis_result = ml_service.analyze_text(post.raw_text)

        clean_text = analysis_result.get("clean_text")
        predicted_label = analysis_result.get("predicted_label")
        confidence = analysis_result.get("confidence")
        topic_vector = analysis_result.get("topic_vector")
        result_model_version = analysis_result.get("model_version")

        if result_model_version is None:
            result_model_version = model_version

        if not save:
            return {
                "status": "ok",
                "stored": False,
                "clean_text": clean_text,
                "predicted_label": predicted_label,
                "confidence": confidence,
                "topic_vector": topic_vector,
                "model_version": result_model_version,
            }

        try:
            if existing is not None:
                existing.clean_text = clean_text
                existing.predicted_label = predicted_label
                existing.confidence = confidence
                existing.topic_vector = topic_vector
                existing.model_version = result_model_version
                db.add(existing)
            else:
                new_analysis = PostAnalysis(
                    post_id=post.id,
                    model_version=result_model_version,
                    clean_text=clean_text,
                    predicted_label=predicted_label,
                    confidence=confidence,
                    topic_vector=topic_vector,
                )
                db.add(new_analysis)

            db.commit()
        except Exception:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail="failed to save analysis",
            )

        return {
            "status": "ok",
            "stored": True,
            "clean_text": clean_text,
            "predicted_label": predicted_label,
            "confidence": confidence,
            "topic_vector": topic_vector,
            "model_version": result_model_version,
        }

    if save is None:
        save = False

    if save:
        raise HTTPException(
            status_code=400,
            detail="save=true requires post_id",
        )

    analysis_result = ml_service.analyze_text(raw_text)

    clean_text = analysis_result.get("clean_text")
    predicted_label = analysis_result.get("predicted_label")
    confidence = analysis_result.get("confidence")
    topic_vector = analysis_result.get("topic_vector")
    result_model_version = analysis_result.get("model_version")

    if result_model_version is None:
        result_model_version = model_version

    return {
        "status": "ok",
        "stored": False,
        "clean_text": clean_text,
        "predicted_label": predicted_label,
        "confidence": confidence,
        "topic_vector": topic_vector,
        "model_version": result_model_version,
    }


@router.post("/batch_analyze")
def batch_analyze(body: dict, db: Session = Depends(get_db)):
    post_ids = body.get("post_ids")

    if post_ids is None:
        raise HTTPException(status_code=400, detail="post_ids is required")

    if len(post_ids) > 200:
        raise HTTPException(status_code=400, detail="too many post_ids")

    total = 0
    stored_new = 0
    reused_existing = 0
    errors = 0
    results = []

    model_version = "tfidf_lr_v1"

    for post_id in post_ids:
        total = total + 1

        try:
            post = db.query(Post).filter(Post.id == post_id).first()

            if post is None:
                errors = errors + 1
                results.append(
                    {"post_id": post_id, "error": "Post not found"}
                )
                continue

            if post.raw_text is None or post.raw_text == "":
                errors = errors + 1
                results.append(
                    {"post_id": post.id, "error": "Post has no raw_text"}
                )
                continue

            existing = (
                db.query(PostAnalysis)
                .filter(PostAnalysis.post_id == post.id)
                .filter(PostAnalysis.model_version == model_version)
                .first()
            )

            if existing is not None:
                reused_existing = reused_existing + 1
                analysis_data = {
                    "clean_text": existing.clean_text,
                    "predicted_label": existing.predicted_label,
                    "confidence": existing.confidence,
                    "topic_vector": existing.topic_vector,
                    "model_version": existing.model_version,
                }
                results.append(
                    {
                        "post_id": post.id,
                        "stored": False,
                        "analysis": analysis_data,
                    }
                )
                continue

            analysis_result = ml_service.analyze_text(post.raw_text)

            clean_text = analysis_result.get("clean_text")
            predicted_label = analysis_result.get("predicted_label")
            confidence = analysis_result.get("confidence")
            topic_vector = analysis_result.get("topic_vector")
            result_model_version = analysis_result.get("model_version")

            if result_model_version is None:
                result_model_version = model_version

            new_analysis = PostAnalysis(
                post_id=post.id,
                model_version=result_model_version,
                clean_text=clean_text,
                predicted_label=predicted_label,
                confidence=confidence,
                topic_vector=topic_vector,
            )

            db.add(new_analysis)
            db.commit()

            stored_new = stored_new + 1

            results.append(
                {
                    "post_id": post.id,
                    "stored": True,
                    "analysis": {
                        "clean_text": clean_text,
                        "predicted_label": predicted_label,
                        "confidence": confidence,
                        "topic_vector": topic_vector,
                        "model_version": result_model_version,
                    },
                }
            )
        except Exception:
            db.rollback()
            errors = errors + 1
            results.append(
                {"post_id": post_id, "error": "internal error"}
            )

    return {
        "status": "ok",
        "total": total,
        "stored_new": stored_new,
        "reused_existing": reused_existing,
        "errors": errors,
        "results": results,
    }


@router.post("/run_coordination")
def run_coordination(body: dict, db: Session = Depends(get_db)):
    model_version = body.get("model_version")
    if model_version is None:
        model_version = "tfidf_lr_v1"

    weeks = body.get("weeks")
    if weeks is None:
        weeks = 12
    if weeks <= 0:
        weeks = 12

    min_group_size = body.get("min_group_size")
    if min_group_size is None:
        min_group_size = 3
    if min_group_size < 1:
        min_group_size = 1

    similarity_threshold = body.get("similarity_threshold")
    if similarity_threshold is None:
        similarity_threshold = 0.8

    replace = body.get("replace")
    if replace is None:
        replace = True

    accounts = db.query(Account).all()

    events = []

    for account in accounts:
        rows = (
            db.query(Post, PostAnalysis)
            .join(PostAnalysis, Post.id == PostAnalysis.post_id)
            .filter(Post.account_id == account.id)
            .filter(PostAnalysis.model_version == model_version)
            .all()
        )

        weekly = {}

        for post, analysis in rows:
            vector = analysis.topic_vector
            if vector is None:
                continue
            if not isinstance(vector, list):
                continue
            if len(vector) == 0:
                continue

            dt = post.captured_at
            if dt is None:
                dt = post.created_at
            if dt is None:
                continue

            date_value = dt.date()
            week_start_date = date_value - timedelta(days=date_value.weekday())
            week_key = week_start_date.isoformat()

            if week_key not in weekly:
                sums = []
                index = 0
                while index < len(vector):
                    sums.append(0.0)
                    index = index + 1
                weekly[week_key] = {"sum": sums, "count": 0}

            info = weekly[week_key]
            sums = info["sum"]

            index = 0
            while index < len(vector):
                try:
                    value = float(vector[index])
                except Exception:
                    value = 0.0
                sums[index] = sums[index] + value
                index = index + 1

            info["count"] = info["count"] + 1

        week_keys = list(weekly.keys())
        week_keys.sort()

        avg_weeks = []

        for key in week_keys:
            info = weekly[key]
            count = info["count"]
            if count == 0:
                continue

            sums = info["sum"]
            avg_vector = []

            index = 0
            while index < len(sums):
                avg_value = sums[index] / float(count)
                avg_vector.append(avg_value)
                index = index + 1

            top_index = 0
            if len(avg_vector) > 0:
                top_value = avg_vector[0]
                i = 1
                while i < len(avg_vector):
                    if avg_vector[i] > top_value:
                        top_value = avg_vector[i]
                        top_index = i
                    i = i + 1

            if LABEL_ORDER is not None and len(LABEL_ORDER) > 0 and top_index < len(
                LABEL_ORDER
            ):
                label = LABEL_ORDER[top_index]
            else:
                label = str(top_index)

            avg_weeks.append(
                {
                    "week_start": key,
                    "vector": avg_vector,
                    "label": label,
                }
            )

        if len(avg_weeks) < 2:
            continue

        index = 1
        while index < len(avg_weeks):
            prev = avg_weeks[index - 1]
            curr = avg_weeks[index]

            if prev["label"] != curr["label"]:
                event = {
                    "week_start": curr["week_start"],
                    "from_label": prev["label"],
                    "to_label": curr["label"],
                    "account_id": account.id,
                    "prev_vector": prev["vector"],
                    "curr_vector": curr["vector"],
                }
                events.append(event)

            index = index + 1

    if len(events) == 0:
        return {
            "status": "ok",
            "model_version": model_version,
            "weeks": weeks,
            "min_group_size": min_group_size,
            "similarity_threshold": similarity_threshold,
            "stored_groups": 0,
            "items": [],
        }

    week_keys = []
    for event in events:
        key = event["week_start"]
        found = False
        i = 0
        while i < len(week_keys):
            if week_keys[i] == key:
                found = True
                break
            i = i + 1
        if not found:
            week_keys.append(key)

    week_keys.sort()

    if weeks is None or weeks <= 0:
        weeks = 12

    if len(week_keys) > weeks:
        week_keys = week_keys[len(week_keys) - weeks :]

    filtered_events = []
    for event in events:
        key = event["week_start"]
        i = 0
        keep = False
        while i < len(week_keys):
            if week_keys[i] == key:
                keep = True
                break
            i = i + 1
        if keep:
            filtered_events.append(event)

    groups = {}

    for event in filtered_events:
        key = (
            event["week_start"]
            + "|"
            + event["from_label"]
            + "|"
            + event["to_label"]
        )
        if key not in groups:
            groups[key] = []
        groups[key].append(event)

    group_keys = list(groups.keys())

    selected_groups = []

    for key in group_keys:
        events_list = groups[key]
        if len(events_list) < min_group_size:
            continue

        deltas = []

        for event in events_list:
            prev_vector = event["prev_vector"]
            curr_vector = event["curr_vector"]

            length = len(prev_vector)
            if len(curr_vector) < length:
                length = len(curr_vector)

            delta = []
            i = 0
            while i < length:
                delta_value = float(curr_vector[i]) - float(prev_vector[i])
                delta.append(delta_value)
                i = i + 1

            deltas.append(delta)

        if len(deltas) == 0:
            continue

        length = len(deltas[0])
        sum_delta = []
        i = 0
        while i < length:
            sum_delta.append(0.0)
            i = i + 1

        for delta in deltas:
            i = 0
            while i < length and i < len(delta):
                sum_delta[i] = sum_delta[i] + float(delta[i])
                i = i + 1

        mean_delta = []
        i = 0
        while i < length:
            mean_value = sum_delta[i] / float(len(deltas))
            mean_delta.append(mean_value)
            i = i + 1

        norm_mean = 0.0
        i = 0
        while i < len(mean_delta):
            v = float(mean_delta[i])
            norm_mean = norm_mean + v * v
            i = i + 1

        if norm_mean <= 0.0:
            similarity = 0.0
        else:
            similarity_sum = 0.0
            for delta in deltas:
                dot = 0.0
                norm_delta = 0.0
                i = 0
                while i < len(mean_delta) and i < len(delta):
                    va = float(delta[i])
                    vb = float(mean_delta[i])
                    dot = dot + va * vb
                    norm_delta = norm_delta + va * va
                    i = i + 1

                if norm_delta <= 0.0:
                    sim_value = 0.0
                else:
                    sim_value = dot / (sqrt(norm_delta) * sqrt(norm_mean))

                similarity_sum = similarity_sum + sim_value

            similarity = similarity_sum / float(len(deltas))

        if similarity < similarity_threshold:
            continue

        parts = key.split("|")
        week_start_value = parts[0]
        from_label = parts[1]
        to_label = parts[2]

        member_account_ids = []

        for event in events_list:
            account_id = event["account_id"]
            found = False
            i = 0
            while i < len(member_account_ids):
                if member_account_ids[i] == account_id:
                    found = True
                    break
                i = i + 1
            if not found:
                member_account_ids.append(account_id)

        group_size = len(member_account_ids)

        selected_groups.append(
            {
                "week_start": week_start_value,
                "from_label": from_label,
                "to_label": to_label,
                "similarity": similarity,
                "member_account_ids": member_account_ids,
                "group_size": group_size,
            }
        )

    stored_groups = 0
    items = []

    try:
        if replace:
            db.query(CoordinatedGroup).delete()

        for group in selected_groups:
            parts = group["week_start"].split("-")
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])

            week_start_date = date(year, month, day)

            similarity_value = float(group["similarity"])

            raw_ids = group["member_account_ids"]
            member_ids = []
            i = 0
            while i < len(raw_ids):
                try:
                    value = int(raw_ids[i])
                    member_ids.append(value)
                except Exception:
                    pass
                i = i + 1

            details = {"group_size": int(group["group_size"])}

            group_row = CoordinatedGroup(
                week_start=week_start_date,
                from_label=group["from_label"],
                to_label=group["to_label"],
                similarity=similarity_value,
                member_account_ids=member_ids,
                details=details,
            )

            db.add(group_row)
            db.flush()

            item = {
                "id": group_row.id,
                "week_start": group_row.week_start,
                "from_label": group_row.from_label,
                "to_label": group_row.to_label,
                "similarity": group_row.similarity,
                "member_account_ids": group_row.member_account_ids,
                "details": group_row.details,
                "created_at": group_row.created_at,
            }

            items.append(item)
            stored_groups = stored_groups + 1

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )

    return {
        "status": "ok",
        "model_version": model_version,
        "weeks": weeks,
        "min_group_size": min_group_size,
        "similarity_threshold": similarity_threshold,
        "stored_groups": stored_groups,
        "items": items,
    }


@router.post("/run_alerts")
def run_alerts(body: dict, db: Session = Depends(get_db)):
    model_version = body.get("model_version")
    if model_version is None:
        model_version = "tfidf_lr_v1"

    weeks = body.get("weeks")
    if weeks is None:
        weeks = 12
    if weeks <= 0:
        weeks = 12

    drift_threshold = body.get("drift_threshold")
    if drift_threshold is None:
        drift_threshold = 0.25

    replace = body.get("replace")
    if replace is None:
        replace = False

    created = 0
    skipped_duplicates = 0
    new_alerts = []

    try:
        if replace:
            db.query(Alert).delete()

        groups = db.query(CoordinatedGroup).all()

        week_keys = []
        for group in groups:
            key = group.week_start
            found = False
            i = 0
            while i < len(week_keys):
                if week_keys[i] == key:
                    found = True
                    break
                i = i + 1
            if not found:
                week_keys.append(key)

        week_keys.sort()

        if weeks is None or weeks <= 0:
            weeks = 12

        if len(week_keys) > weeks:
            week_keys = week_keys[len(week_keys) - weeks :]

        for group in groups:
            key = group.week_start
            keep = False
            i = 0
            while i < len(week_keys):
                if week_keys[i] == key:
                    keep = True
                    break
                i = i + 1
            if not keep:
                continue

            existing = (
                db.query(Alert)
                .filter(Alert.alert_type == "coordination")
                .filter(Alert.coordinated_group_id == group.id)
                .first()
            )

            if existing is not None:
                skipped_duplicates = skipped_duplicates + 1
                continue

            try:
                similarity_value = float(group.similarity)
            except Exception:
                similarity_value = 0.0

            if similarity_value >= 0.9:
                severity = "high"
            else:
                severity = "medium"

            member_ids = []
            raw_ids = group.member_account_ids
            if raw_ids is not None:
                i = 0
                while i < len(raw_ids):
                    try:
                        value = int(raw_ids[i])
                        member_ids.append(value)
                    except Exception:
                        pass
                    i = i + 1

            member_count = len(member_ids)

            member_names = []
            if len(member_ids) > 0:
                accounts = db.query(Account).filter(Account.id.in_(member_ids)).all()
                for acc in accounts:
                    member_names.append(acc.handle)

            if len(member_names) > 0:
                if len(member_names) == 1:
                    names_formatted = member_names[0]
                elif len(member_names) == 2:
                    names_formatted = f"{member_names[0]} and {member_names[1]}"
                else:
                    names_formatted = ", ".join(member_names[:-1]) + " and " + member_names[-1]
                
                message = "Coordination detected between " + names_formatted
            else:
                message = (
                    "Coordination detected: "
                    + str(group.from_label)
                    + " -> "
                    + str(group.to_label)
                    + " (members="
                    + str(member_count)
                    + ")"
                )

            if group.week_start is not None:
                week_start_str = group.week_start.isoformat()
            else:
                week_start_str = None

            payload = {
                "week_start": week_start_str,
                "similarity": similarity_value,
                "member_account_ids": member_ids,
            }

            alert_row = Alert(
                alert_type="coordination",
                severity=severity,
                account_id=None,
                coordinated_group_id=group.id,
                message=message,
                payload=payload,
                is_read=False,
            )

            db.add(alert_row)
            db.flush()

            new_alerts.append(alert_row)
            created = created + 1

        accounts = db.query(Account).all()

        for account in accounts:
            rows = (
                db.query(Post, PostAnalysis)
                .join(PostAnalysis, Post.id == PostAnalysis.post_id)
                .filter(Post.account_id == account.id)
                .filter(PostAnalysis.model_version == model_version)
                .all()
            )

            weekly = {}

            for post, analysis in rows:
                vector = analysis.topic_vector
                if vector is None:
                    continue
                if not isinstance(vector, list):
                    continue
                if len(vector) == 0:
                    continue

                dt = post.published_at
                if dt is None:
                    dt = post.captured_at
                if dt is None:
                    dt = post.created_at
                if dt is None:
                    continue

                date_value = dt.date()
                week_start_date = date_value - timedelta(days=date_value.weekday())
                week_key = week_start_date.isoformat()

                if week_key not in weekly:
                    sums = []
                    index = 0
                    while index < len(vector):
                        sums.append(0.0)
                        index = index + 1
                    weekly[week_key] = {"sum": sums, "count": 0}

                info = weekly[week_key]
                sums = info["sum"]

                index = 0
                while index < len(vector):
                    try:
                        value = float(vector[index])
                    except Exception:
                        value = 0.0
                    sums[index] = sums[index] + value
                    index = index + 1

                info["count"] = info["count"] + 1

            week_keys = list(weekly.keys())
            week_keys.sort()

            if len(week_keys) < 2:
                continue

            if len(week_keys) > weeks:
                week_keys = week_keys[len(week_keys) - weeks :]

            avg_weeks = []

            for key in week_keys:
                info = weekly[key]
                count = info["count"]
                if count == 0:
                    continue

                sums = info["sum"]
                avg_vector = []

                index = 0
                while index < len(sums):
                    avg_value = sums[index] / float(count)
                    avg_vector.append(avg_value)
                    index = index + 1

                avg_weeks.append({"week_start": key, "vector": avg_vector})

            if len(avg_weeks) < 2:
                continue

            drift_points = []

            index = 1
            while index < len(avg_weeks):
                prev = avg_weeks[index - 1]
                curr = avg_weeks[index]

                a = prev["vector"]
                b = curr["vector"]

                length = len(a)
                if len(b) < length:
                    length = len(b)

                dot = 0.0
                norm_a = 0.0
                norm_b = 0.0

                i = 0
                while i < length:
                    va = float(a[i])
                    vb = float(b[i])
                    dot = dot + va * vb
                    norm_a = norm_a + va * va
                    norm_b = norm_b + vb * vb
                    i = i + 1

                if norm_a <= 0.0 or norm_b <= 0.0:
                    sim = 0.0
                else:
                    sim = dot / (sqrt(norm_a) * sqrt(norm_b))

                drift_value = 1.0 - sim

                drift_points.append(
                    {"week_start": curr["week_start"], "drift": drift_value}
                )

                index = index + 1

            if len(drift_points) == 0:
                continue

            max_point = None

            for point in drift_points:
                if max_point is None:
                    max_point = point
                else:
                    if point["drift"] > max_point["drift"]:
                        max_point = point

            if max_point is None:
                continue

            max_drift_value = float(max_point["drift"])
            if max_drift_value < drift_threshold:
                continue

            week_start_str = max_point["week_start"]

            existing_alerts = (
                db.query(Alert)
                .filter(Alert.alert_type == "drift")
                .filter(Alert.account_id == account.id)
                .all()
            )

            duplicate_found = False
            for alert in existing_alerts:
                payload = alert.payload
                if payload is None:
                    continue
                if not isinstance(payload, dict):
                    continue
                existing_week = payload.get("week_start")
                if existing_week == week_start_str:
                    duplicate_found = True
                    break

            if duplicate_found:
                skipped_duplicates = skipped_duplicates + 1
                continue

            if max_drift_value >= drift_threshold * 1.5:
                severity = "high"
            else:
                severity = "medium"

            message = (
                "Drift spike detected: drift="
                + str(max_drift_value)
                + " on week "
                + str(week_start_str)
            )

            payload = {
                "week_start": week_start_str,
                "drift": max_drift_value,
            }

            alert_row = Alert(
                alert_type="drift",
                severity=severity,
                account_id=account.id,
                coordinated_group_id=None,
                message=message,
                payload=payload,
                is_read=False,
            )

            db.add(alert_row)
            db.flush()

            new_alerts.append(alert_row)
            created = created + 1

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    items = []

    for alert in new_alerts:
        item = {
            "id": alert.id,
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "account_id": alert.account_id,
            "coordinated_group_id": alert.coordinated_group_id,
            "message": alert.message,
            "payload": alert.payload,
            "is_read": alert.is_read,
            "created_at": alert.created_at,
        }
        items.append(item)

    return {
        "status": "ok",
        "created": created,
        "skipped_duplicates": skipped_duplicates,
        "items": items,
    }
